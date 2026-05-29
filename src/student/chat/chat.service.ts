import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { MAX_MESSAGE_LENGTH } from './dto/chat.dto';

const DEFAULT_RETENTION_DAYS = 90;
const PREVIEW_LENGTH = 200;

/** A groupmate the caller may start a chat with. */
export interface ChatContact {
  id: number;
  display_name: string;
  /** Roll number. */
  student_id: string;
}

/** One message as returned to the client (REST history + socket events). */
export interface ChatMessageDto {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  created_at: string;
}

/** A row in the caller's conversation list. */
export interface ChatConversationSummary {
  id: number;
  other: ChatContact;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_message_sender_id: number | null;
  /** Newest message id the *other* participant has read — drives sender ticks. */
  other_last_read_message_id: number | null;
  /** Unread messages from the other participant. */
  unread: number;
}

export interface ChatMessagesPage {
  items: ChatMessageDto[]; // newest first (for an inverted list)
  has_more: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
    private readonly config: ConfigService,
  ) {}

  /** Configured message lifetime in days (env `CHAT_MESSAGE_RETENTION_DAYS`). */
  retentionDays(): number {
    const raw = this.config.get<string | number>(
      'CHAT_MESSAGE_RETENTION_DAYS',
      DEFAULT_RETENTION_DAYS,
    );
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_RETENTION_DAYS;
  }

  /**
   * Confirm the two students share a non-null attendance group and return that
   * group id. Throws otherwise. This is the single chokepoint enforcing "you
   * may only chat with someone in your own attendance group"; it runs when a
   * conversation is created (not on every message) to keep the hot path cheap.
   */
  async resolveSharedGroup(meId: number, otherId: number): Promise<number> {
    if (meId === otherId) {
      throw new ForbiddenException('You cannot message yourself.');
    }
    const rows = await this.studentGroups.find({
      where: [{ student_id: meId }, { student_id: otherId }],
    });
    const mine = rows.find((r) => r.student_id === meId);
    const theirs = rows.find((r) => r.student_id === otherId);
    if (
      !mine?.attendance_group_id ||
      !theirs?.attendance_group_id ||
      mine.attendance_group_id !== theirs.attendance_group_id
    ) {
      throw new ForbiddenException(
        'You can only message students in your attendance group.',
      );
    }
    return mine.attendance_group_id;
  }

  /** Find or create the canonical conversation row for the pair. */
  async getOrCreateConversation(
    meId: number,
    otherId: number,
  ): Promise<ChatConversation> {
    const groupId = await this.resolveSharedGroup(meId, otherId);
    const low = Math.min(meId, otherId);
    const high = Math.max(meId, otherId);

    const existing = await this.conversations.findOne({
      where: { student_low_id: low, student_high_id: high },
    });
    if (existing) return existing;

    try {
      return await this.conversations.save(
        this.conversations.create({
          student_low_id: low,
          student_high_id: high,
          attendance_group_id: groupId,
        }),
      );
    } catch {
      // A concurrent send may have created it first — the unique constraint
      // rejected the race loser; fetch the winner's row.
      const raced = await this.conversations.findOne({
        where: { student_low_id: low, student_high_id: high },
      });
      if (raced) return raced;
      throw new ForbiddenException('Could not open the conversation.');
    }
  }

  /** Persist a message and refresh the conversation's denormalised tail. */
  async saveMessage(
    conv: ChatConversation,
    senderId: number,
    body: string,
  ): Promise<ChatMessage> {
    const trimmed = body.trim().slice(0, MAX_MESSAGE_LENGTH);
    const msg = await this.messages.save(
      this.messages.create({
        conversation_id: conv.id,
        sender_id: senderId,
        body: trimmed,
      }),
    );
    await this.conversations.update(conv.id, {
      last_message_at: msg.created_at,
      last_message_preview: trimmed.slice(0, PREVIEW_LENGTH),
      last_message_sender_id: senderId,
    });
    return msg;
  }

  /** Fetch a conversation the caller participates in, or throw 404. */
  async getParticipantConversation(
    meId: number,
    convId: number,
  ): Promise<ChatConversation> {
    const conv = await this.conversations.findOne({ where: { id: convId } });
    if (
      !conv ||
      (conv.student_low_id !== meId && conv.student_high_id !== meId)
    ) {
      throw new NotFoundException('Conversation not found.');
    }
    return conv;
  }

  otherParticipant(conv: ChatConversation, meId: number): number {
    return conv.student_low_id === meId
      ? conv.student_high_id
      : conv.student_low_id;
  }

  /** A page of history for a conversation, newest first, seeking by id. */
  async listMessages(
    meId: number,
    convId: number,
    before: number | undefined,
    limit: number,
  ): Promise<ChatMessagesPage> {
    await this.getParticipantConversation(meId, convId);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :convId', { convId })
      .orderBy('m.id', 'DESC')
      .take(limit + 1);
    if (before) qb.andWhere('m.id < :before', { before });

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((m) => this.toDto(m)),
      has_more: hasMore,
    };
  }

  /**
   * Move the caller's read cursor to the latest message in the conversation.
   * Returns the new cursor and the other participant so the gateway can notify
   * them. One UPDATE; no per-message writes.
   */
  async markRead(
    meId: number,
    convId: number,
  ): Promise<{
    conversationId: number;
    lastReadMessageId: number | null;
    otherId: number;
  }> {
    const conv = await this.getParticipantConversation(meId, convId);
    const otherId = this.otherParticipant(conv, meId);

    const latest = await this.messages
      .createQueryBuilder('m')
      .select('MAX(m.id)', 'maxId')
      .where('m.conversation_id = :convId', { convId })
      .getRawOne<{ maxId: string | null }>();
    const lastId = latest?.maxId != null ? Number(latest.maxId) : null;

    if (lastId != null) {
      const isLow = conv.student_low_id === meId;
      await this.conversations.update(
        convId,
        isLow
          ? { low_last_read_message_id: lastId }
          : { high_last_read_message_id: lastId },
      );
    }
    return { conversationId: convId, lastReadMessageId: lastId, otherId };
  }

  /** The caller's conversations (those with at least one message), newest first. */
  async listConversations(meId: number): Promise<ChatConversationSummary[]> {
    const rows = await this.conversations.manager.query<
      Array<{
        id: number;
        other_id: number;
        other_name: string;
        other_roll: string;
        last_message_preview: string | null;
        last_message_at: Date | null;
        last_message_sender_id: number | null;
        other_last_read: string | null;
        unread: number;
      }>
    >(
      `
      SELECT
        c.id,
        CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END AS other_id,
        s.display_name AS other_name,
        s.student_id   AS other_roll,
        c.last_message_preview,
        c.last_message_at,
        c.last_message_sender_id,
        CASE WHEN c.student_low_id = $1 THEN c.high_last_read_message_id ELSE c.low_last_read_message_id END AS other_last_read,
        (SELECT COUNT(*) FROM "chat_messages" m
           WHERE m.conversation_id = c.id
             AND m.sender_id <> $1
             AND m.id > COALESCE(
               CASE WHEN c.student_low_id = $1 THEN c.low_last_read_message_id ELSE c.high_last_read_message_id END, 0))::int
          AS unread
      FROM "chat_conversations" c
      JOIN "students" s
        ON s.id = (CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END)
      WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
        AND c.last_message_at IS NOT NULL
      ORDER BY c.last_message_at DESC
      `,
      [meId],
    );

    return rows.map((r) => ({
      id: Number(r.id),
      other: {
        id: Number(r.other_id),
        display_name: r.other_name,
        student_id: r.other_roll,
      },
      last_message_preview: r.last_message_preview,
      last_message_at: r.last_message_at
        ? new Date(r.last_message_at).toISOString()
        : null,
      last_message_sender_id:
        r.last_message_sender_id != null ? Number(r.last_message_sender_id) : null,
      other_last_read_message_id:
        r.other_last_read != null ? Number(r.other_last_read) : null,
      unread: Number(r.unread),
    }));
  }

  /** Total unread across all the caller's conversations — for the menu badge. */
  async totalUnread(meId: number): Promise<number> {
    const row = await this.conversations.manager.query<
      Array<{ total: number }>
    >(
      `
      SELECT COALESCE(SUM(sub.unread), 0)::int AS total FROM (
        SELECT (SELECT COUNT(*) FROM "chat_messages" m
                 WHERE m.conversation_id = c.id
                   AND m.sender_id <> $1
                   AND m.id > COALESCE(
                     CASE WHEN c.student_low_id = $1 THEN c.low_last_read_message_id ELSE c.high_last_read_message_id END, 0)) AS unread
        FROM "chat_conversations" c
        WHERE c.student_low_id = $1 OR c.student_high_id = $1
      ) sub
      `,
      [meId],
    );
    return Number(row[0]?.total ?? 0);
  }

  /** Active groupmates the caller may start a chat with (excluding themselves). */
  async listContacts(meId: number): Promise<ChatContact[]> {
    const rows = await this.studentGroups.manager.query<
      Array<{ id: number; display_name: string; student_id: string }>
    >(
      `
      SELECT s.id, s.display_name, s.student_id
      FROM "student_groups" sg
      JOIN "students" s ON s.id = sg.student_id
      WHERE sg.attendance_group_id = (
              SELECT attendance_group_id FROM "student_groups" WHERE student_id = $1
            )
        AND sg.attendance_group_id IS NOT NULL
        AND s.id <> $1
        AND s.is_active = TRUE
      ORDER BY s.display_name ASC
      `,
      [meId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      display_name: r.display_name,
      student_id: r.student_id,
    }));
  }

  toDto(m: ChatMessage): ChatMessageDto {
    return {
      id: m.id,
      conversation_id: m.conversation_id,
      sender_id: m.sender_id,
      body: m.body,
      created_at: m.created_at.toISOString(),
    };
  }
}
