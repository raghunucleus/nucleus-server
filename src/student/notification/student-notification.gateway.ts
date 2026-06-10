import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { StudentAccessPayload } from '../student-auth.service';

/**
 * Realtime transport for student notifications. Mirrors the chat gateway: auth
 * happens once at the handshake against `JWT_STUDENT_ACCESS_SECRET`, and every
 * connection joins the private room `student:<id>` so an emit reaches all of a
 * student's open devices across server instances (the Redis adapter fans out).
 *
 * Deliberately a separate namespace from `/student/chat` so notification
 * delivery is independent of whether chat is connected. The gateway only emits
 * (server → client); marking read happens over REST.
 */
@WebSocketGateway({
  namespace: '/student/notifications',
  cors: { origin: true, credentials: true },
})
export class StudentNotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('StudentNotificationsGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = this.jwt.verify<StudentAccessPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_STUDENT_ACCESS_SECRET'),
      });
      // A student mid-password-reset must not receive notifications.
      if (payload.mcp) throw new Error('password change pending');
      client.data.studentId = payload.sub;
      await client.join(this.room(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  /** Emit an event to all of a student's open notification sockets. */
  emitToStudent(studentId: number, event: string, payload: unknown): void {
    this.server.to(this.room(studentId)).emit(event, payload);
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
