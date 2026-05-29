import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { StudentAccessPayload } from '../student-auth.service';
import { ChatService } from './chat.service';
import { ConversationRefSchema, SendMessageSchema } from './dto/chat.dto';

/**
 * Realtime transport for student chat. Auth happens once, at the handshake:
 * the student access token (same secret as the HTTP `student-jwt` strategy)
 * must be present and valid, or the socket is dropped. Every connection joins a
 * private room `student:<id>`, so emitting to a participant reaches all of their
 * devices regardless of which server instance holds the socket (the Redis
 * adapter fans the emit out across instances).
 */
@WebSocketGateway({
  namespace: '/student/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('ChatGateway');

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<StudentAccessPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_STUDENT_ACCESS_SECRET'),
      });
      if (payload.mcp) throw new Error('password change pending');
      client.data.studentId = payload.sub;
      await client.join(this.room(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<{ ok: boolean; message?: unknown; error?: string }> {
    const me = this.me(client);
    if (!me) return { ok: false, error: 'Not authenticated.' };

    const parsed = SendMessageSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Invalid message.' };
    const { toStudentId, body, clientTempId } = parsed.data;

    try {
      const conv = await this.chat.getOrCreateConversation(me, toStudentId);
      const msg = await this.chat.saveMessage(conv, me, body);
      // `sender_name` lets the recipient render an in-app notification naming
      // the sender from any screen, without a follow-up lookup.
      const senderName = await this.chat.displayName(me);
      const dto = {
        ...this.chat.toDto(msg),
        sender_name: senderName,
        client_temp_id: clientTempId ?? null,
      };

      // Notify the recipient and the sender's *other* devices (client.to
      // excludes the originating socket — it reconciles via this ack instead).
      client
        .to(this.room(toStudentId))
        .to(this.room(me))
        .emit('message:new', dto);

      // Best-effort delivered tick: only if the recipient currently has a live
      // socket. Not persisted — purely a live signal back to the sender.
      const recipients = await this.server
        .in(this.room(toStudentId))
        .fetchSockets();
      if (recipients.length > 0) {
        this.server.to(this.room(me)).emit('message:delivered', {
          conversation_id: conv.id,
          message_id: msg.id,
        });
      }

      return { ok: true, message: dto };
    } catch (err) {
      const error =
        err instanceof ForbiddenException
          ? err.message
          : 'Could not send the message.';
      return { ok: false, error };
    }
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<{ ok: boolean; last_read_message_id?: number | null }> {
    const me = this.me(client);
    if (!me) return { ok: false };
    const parsed = ConversationRefSchema.safeParse(raw);
    if (!parsed.success) return { ok: false };

    try {
      const res = await this.chat.markRead(me, parsed.data.conversationId);
      client.to(this.room(res.otherId)).emit('message:read', {
        conversation_id: res.conversationId,
        reader_id: me,
        last_read_message_id: res.lastReadMessageId,
      });
      return { ok: true, last_read_message_id: res.lastReadMessageId };
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage('typing:start')
  onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    return this.relayTyping(client, raw, true);
  }

  @SubscribeMessage('typing:stop')
  onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<void> {
    return this.relayTyping(client, raw, false);
  }

  // -------------------------------------------------------------------------

  private async relayTyping(
    client: Socket,
    raw: unknown,
    typing: boolean,
  ): Promise<void> {
    const me = this.me(client);
    if (!me) return;
    const parsed = ConversationRefSchema.safeParse(raw);
    if (!parsed.success) return;
    try {
      const conv = await this.chat.getParticipantConversation(
        me,
        parsed.data.conversationId,
      );
      const otherId = this.chat.otherParticipant(conv, me);
      client.to(this.room(otherId)).emit('typing', {
        conversation_id: conv.id,
        student_id: me,
        typing,
      });
    } catch {
      // Not a participant / no such conversation — silently ignore.
    }
  }

  private me(client: Socket): number | undefined {
    return client.data.studentId as number | undefined;
  }

  private room(studentId: number): string {
    return `student:${studentId}`;
  }

  private extractToken(client: Socket): string {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    const fromHeader = client.handshake.headers?.authorization;
    const raw = fromAuth ?? fromHeader;
    if (!raw) throw new Error('missing token');
    return String(raw).replace(/^Bearer\s+/i, '');
  }
}
