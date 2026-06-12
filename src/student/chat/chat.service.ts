import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { StorageService } from '../../storage/storage.service';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { MAX_MESSAGE_LENGTH } from './dto/chat.dto';

const DEFAULT_RETENTION_DAYS = 90;
const PREVIEW_LENGTH = 200;

/**
 * SQL fragment: the student's photo key, or NULL when they hid their photo
 * from peers. Every list below selects this instead of the raw column so the
 * privacy setting is enforced at the source.
 */
const VISIBLE_PHOTO_KEY = (alias: string) =>
  `CASE WHEN ${alias}.hidden_profile_fields @> '["photo"]'::jsonb THEN NULL ELSE ${alias}.photo_key END`;

/** A groupmate the caller may start a chat with. */
export interface ChatContact {
  id: number;
  display_name: string;
  /** Roll number. */
  student_id: string;
  /** Presigned, short-lived photo URL; null when unset or hidden by privacy. */
  photo_url: string | null;
}

/** One message as returned to the client (REST history + socket events). */
export interface ChatMessageDto {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  created_at: string;
  /**
   * Sender's display name. Only populated on the realtime `message:new` event
   * (so a global in-app notification can name the sender); REST history omits
   * it — the thread screen already knows the other participant's name.
   */
  sender_name?: string;
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
  /** Consent state. `pending` here only ever means an invite *I* sent (outgoing). */
  status: 'pending' | 'accepted';
  /** Did I send the invite? While `pending`, this is always true in this list. */
  is_initiator: boolean;
  /** Have I muted this conversation? */
  muted: boolean;
  /** Have I blocked the other participant? (Their block of me is never exposed.) */
  blocked_by_me: boolean;
}

/** Per-conversation consent/block/mute state for the acting student. */
export interface ChatConversationMeta {
  id: number;
  other: ChatContact;
  status: 'pending' | 'accepted';
  /** Did I send the invite? (Relevant only while pending.) */
  is_initiator: boolean;
  muted: boolean;
  blocked_by_me: boolean;
}

/** An incoming pending request in the caller's Requests inbox. */
export interface ChatRequestSummary {
  id: number;
  other: ChatContact;
  invite_preview: string | null;
  invite_at: string | null;
  initiated_by_id: number;
}

/** Outcome of {@link ChatService.assertSend}. */
export type SendAuth =
  | { kind: 'ALLOW' }
  /** Recipient has blocked the sender — fake success, drop the message silently. */
  | { kind: 'ALLOW_SILENT' }
  | { kind: 'REJECT'; reason: string };

export interface ChatMessagesPage {
  items: ChatMessageDto[]; // newest first (for an inverted list)
  has_more: boolean;
}

/** A page of new-chat contacts. `total` ignores limit/offset (drives "has more"). */
export interface ChatContactsPage {
  total: number;
  items: ChatContact[];
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
    private readonly storage: StorageService,
  ) {}

  /**
   * Stable ~12h URL for a (privacy-filtered) photo key. Cached per key, so
   * list refreshes return the same URL and device image caches actually hit.
   * No HEAD probe — clients fall back to initials on a 404.
   */
  private photoUrl(key: string | null): Promise<string | null> {
    return key ? this.storage.getCachedReadUrl(key) : Promise.resolve(null);
  }

  /** Configured message lifetime in days (env `CHAT_MESSAGE_RETENTION_DAYS`). */
  retentionDays(): number {
    const raw = this.config.get<string | number>(
      'CHAT_MESSAGE_RETENTION_DAYS',
      DEFAULT_RETENTION_DAYS,
    );
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0
      ? Math.trunc(n)
      : DEFAULT_RETENTION_DAYS;
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
          // A brand-new conversation is a request: pending until the recipient
          // accepts, initiated by whoever opened it.
          status: 'pending',
          initiated_by_id: meId,
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

  // ---------------------------------------------------------------------------
  // Consent gate + block/mute
  // ---------------------------------------------------------------------------

  /** Is `meId` the low participant of this conversation? */
  private amLow(conv: ChatConversation, meId: number): boolean {
    return conv.student_low_id === meId;
  }

  /**
   * Decide whether `senderId` may send into `conv`. Pure — no DB writes. The
   * order of the branches matters:
   *
   * 1. If *I* blocked the other party, I get an explicit error (my own UI).
   * 2. If the *other* party blocked me, the send silently succeeds and is
   *    dropped — the blocked sender must never be able to tell.
   * 3. An accepted conversation is open.
   * 4. A pending conversation only allows the inviter's single invite message;
   *    the recipient must accept (a separate action) before replying.
   *
   * `isFirstMessage` should be `conv.last_message_at === null` — the inviter's
   * very first send. No count query needed.
   */
  assertSend(
    conv: ChatConversation,
    senderId: number,
    isFirstMessage: boolean,
  ): SendAuth {
    const low = this.amLow(conv, senderId);
    const iBlockedThem = low ? conv.low_blocked : conv.high_blocked;
    const theyBlockedMe = low ? conv.high_blocked : conv.low_blocked;

    if (iBlockedThem) {
      return { kind: 'REJECT', reason: 'Unblock to message this person.' };
    }
    if (theyBlockedMe) {
      // Covers both a later-blocked accepted chat and a request declined by
      // block — the sender sees a normal "sent", we drop it.
      return { kind: 'ALLOW_SILENT' };
    }
    if (conv.status === 'accepted') {
      return { kind: 'ALLOW' };
    }
    // status === 'pending'
    if (senderId === conv.initiated_by_id) {
      return isFirstMessage
        ? { kind: 'ALLOW' }
        : {
            kind: 'REJECT',
            reason: 'Waiting for them to accept your request.',
          };
    }
    return { kind: 'REJECT', reason: 'Accept the request to reply.' };
  }

  /** True if the recipient has muted this conversation (suppresses their push). */
  recipientMuted(conv: ChatConversation, recipientId: number): boolean {
    return this.amLow(conv, recipientId) ? conv.low_muted : conv.high_muted;
  }

  /**
   * How many of the other participant's messages `recipientId` hasn't read yet
   * (their read cursor as loaded on `conv` — a refresh-free snapshot is fine
   * for a push title). Includes a message saved after `conv` was fetched.
   */
  unreadCount(conv: ChatConversation, recipientId: number): Promise<number> {
    const cursor = this.amLow(conv, recipientId)
      ? conv.low_last_read_message_id
      : conv.high_last_read_message_id;
    return this.messages.count({
      where: {
        conversation_id: conv.id,
        sender_id: this.otherParticipant(conv, recipientId),
        id: MoreThan(cursor ?? 0),
      },
    });
  }

  /**
   * Accept an incoming request. Only the recipient (not the initiator) may
   * accept, and only while pending. Optionally mutes in the same step. Returns
   * the inviter's id so the gateway can unlock their thread in realtime.
   */
  async acceptRequest(
    meId: number,
    convId: number,
    mute: boolean,
  ): Promise<{ otherId: number }> {
    const conv = await this.getParticipantConversation(meId, convId);
    if (conv.status !== 'pending') {
      throw new ForbiddenException('There is no pending request to accept.');
    }
    if (meId === conv.initiated_by_id) {
      throw new ForbiddenException('You cannot accept your own request.');
    }
    const patch: Partial<ChatConversation> = { status: 'accepted' };
    if (mute) {
      if (this.amLow(conv, meId)) patch.low_muted = true;
      else patch.high_muted = true;
    }
    await this.conversations.update(convId, patch);
    return { otherId: this.otherParticipant(conv, meId) };
  }

  /** Block the other participant (any status). Idempotent; status untouched. */
  async blockConversation(meId: number, convId: number): Promise<void> {
    await this.setMyFlag(meId, convId, 'blocked', true);
  }

  /** Unblock the other participant. Idempotent. */
  async unblockConversation(meId: number, convId: number): Promise<void> {
    await this.setMyFlag(meId, convId, 'blocked', false);
  }

  /** Mute the conversation (suppresses my push). Any status. Idempotent. */
  async muteConversation(meId: number, convId: number): Promise<void> {
    await this.setMyFlag(meId, convId, 'muted', true);
  }

  /** Unmute the conversation. Idempotent. */
  async unmuteConversation(meId: number, convId: number): Promise<void> {
    await this.setMyFlag(meId, convId, 'muted', false);
  }

  /** Set the caller's own `low_*`/`high_*` block/mute flag after a membership check. */
  private async setMyFlag(
    meId: number,
    convId: number,
    flag: 'blocked' | 'muted',
    value: boolean,
  ): Promise<void> {
    const conv = await this.getParticipantConversation(meId, convId);
    const column = `${this.amLow(conv, meId) ? 'low' : 'high'}_${flag}`;
    await this.conversations.update(convId, { [column]: value });
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

  /**
   * The acting student's consent/block/mute view of one conversation. Used by
   * the thread screen (reached from the list, a new chat, or a notification
   * deep-link) to decide whether the composer is open, waiting, or blocked.
   */
  async conversationMeta(
    meId: number,
    convId: number,
  ): Promise<ChatConversationMeta> {
    const conv = await this.getParticipantConversation(meId, convId);
    const otherId = this.otherParticipant(conv, meId);
    const rows = await this.conversations.manager.query<
      Array<{
        display_name: string;
        student_id: string;
        photo_key: string | null;
      }>
    >(
      `SELECT display_name, student_id, ${VISIBLE_PHOTO_KEY('s')} AS photo_key
       FROM "students" s WHERE id = $1`,
      [otherId],
    );
    const low = this.amLow(conv, meId);
    return {
      id: conv.id,
      other: {
        id: otherId,
        display_name: rows[0]?.display_name ?? 'Someone',
        student_id: rows[0]?.student_id ?? '',
        photo_url: await this.photoUrl(rows[0]?.photo_key ?? null),
      },
      status: conv.status,
      is_initiator: conv.initiated_by_id === meId,
      muted: low ? conv.low_muted : conv.high_muted,
      blocked_by_me: low ? conv.low_blocked : conv.high_blocked,
    };
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
   * Full-history search within a single conversation the caller participates in,
   * newest first. Matches `query` as a literal substring of the message body
   * (case-insensitive). LIKE wildcards in the user's input are escaped so `%`
   * and `_` match themselves. Pages back with `before` like {@link listMessages}.
   */
  async searchMessages(
    meId: number,
    convId: number,
    query: string,
    limit: number,
    before?: number,
  ): Promise<ChatMessagesPage> {
    await this.getParticipantConversation(meId, convId);
    const term = query.trim();
    if (!term) return { items: [], has_more: false };

    // Backslash is Postgres' default LIKE escape char; neutralise it plus the
    // two wildcards so the term is matched literally.
    const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :convId', { convId })
      .andWhere('m.body ILIKE :pattern', { pattern: `%${escaped}%` })
      .orderBy('m.id', 'DESC')
      .take(limit + 1);
    if (before) qb.andWhere('m.id < :before', { before });

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page.map((m) => this.toDto(m)), has_more: hasMore };
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

  /**
   * The caller's conversations (those with at least one message), newest first.
   * Incoming pending requests are excluded here — they live in the Requests
   * inbox ({@link listRequests}). Outgoing pending (an invite I sent) is kept so
   * the inviter sees their sent request with compose disabled until accepted.
   */
  async listConversations(meId: number): Promise<ChatConversationSummary[]> {
    const rows = await this.conversations.manager.query<
      Array<{
        id: number;
        other_id: number;
        other_name: string;
        other_roll: string;
        other_photo_key: string | null;
        last_message_preview: string | null;
        last_message_at: Date | null;
        last_message_sender_id: number | null;
        other_last_read: string | null;
        unread: number;
        status: 'pending' | 'accepted';
        is_initiator: boolean;
        muted: boolean;
        blocked_by_me: boolean;
      }>
    >(
      `
      SELECT
        c.id,
        CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END AS other_id,
        s.display_name AS other_name,
        s.student_id   AS other_roll,
        ${VISIBLE_PHOTO_KEY('s')} AS other_photo_key,
        c.last_message_preview,
        c.last_message_at,
        c.last_message_sender_id,
        CASE WHEN c.student_low_id = $1 THEN c.high_last_read_message_id ELSE c.low_last_read_message_id END AS other_last_read,
        (SELECT COUNT(*) FROM "chat_messages" m
           WHERE m.conversation_id = c.id
             AND m.sender_id <> $1
             AND m.id > COALESCE(
               CASE WHEN c.student_low_id = $1 THEN c.low_last_read_message_id ELSE c.high_last_read_message_id END, 0))::int
          AS unread,
        c.status,
        (c.initiated_by_id = $1) AS is_initiator,
        (CASE WHEN c.student_low_id = $1 THEN c.low_muted   ELSE c.high_muted   END) AS muted,
        (CASE WHEN c.student_low_id = $1 THEN c.low_blocked ELSE c.high_blocked END) AS blocked_by_me
      FROM "chat_conversations" c
      JOIN "students" s
        ON s.id = (CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END)
      WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
        AND c.last_message_at IS NOT NULL
        AND (c.status = 'accepted' OR c.initiated_by_id = $1)
      ORDER BY c.last_message_at DESC
      `,
      [meId],
    );

    return Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id),
        other: {
          id: Number(r.other_id),
          display_name: r.other_name,
          student_id: r.other_roll,
          photo_url: await this.photoUrl(r.other_photo_key),
        },
        last_message_preview: r.last_message_preview,
        last_message_at: r.last_message_at
          ? new Date(r.last_message_at).toISOString()
          : null,
        last_message_sender_id:
          r.last_message_sender_id != null
            ? Number(r.last_message_sender_id)
            : null,
        other_last_read_message_id:
          r.other_last_read != null ? Number(r.other_last_read) : null,
        unread: Number(r.unread),
        status: r.status,
        is_initiator: Boolean(r.is_initiator),
        muted: Boolean(r.muted),
        blocked_by_me: Boolean(r.blocked_by_me),
      })),
    );
  }

  /**
   * The caller's incoming pending requests — conversations someone else opened
   * by messaging them, not yet accepted, and not declined by the caller's block.
   * This is the Requests inbox; newest first.
   */
  async listRequests(meId: number): Promise<ChatRequestSummary[]> {
    const rows = await this.conversations.manager.query<
      Array<{
        id: number;
        other_id: number;
        other_name: string;
        other_roll: string;
        other_photo_key: string | null;
        invite_preview: string | null;
        invite_at: Date | null;
        initiated_by_id: number;
      }>
    >(
      `
      SELECT
        c.id,
        CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END AS other_id,
        s.display_name AS other_name,
        s.student_id   AS other_roll,
        ${VISIBLE_PHOTO_KEY('s')} AS other_photo_key,
        c.last_message_preview AS invite_preview,
        c.last_message_at      AS invite_at,
        c.initiated_by_id
      FROM "chat_conversations" c
      JOIN "students" s
        ON s.id = (CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END)
      WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
        AND c.status = 'pending'
        AND c.last_message_at IS NOT NULL
        AND c.initiated_by_id IS NOT NULL
        AND c.initiated_by_id <> $1
        AND NOT (CASE WHEN c.student_low_id = $1 THEN c.low_blocked ELSE c.high_blocked END)
      ORDER BY c.last_message_at DESC
      `,
      [meId],
    );

    return Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id),
        other: {
          id: Number(r.other_id),
          display_name: r.other_name,
          student_id: r.other_roll,
          photo_url: await this.photoUrl(r.other_photo_key),
        },
        invite_preview: r.invite_preview,
        invite_at: r.invite_at ? new Date(r.invite_at).toISOString() : null,
        initiated_by_id: Number(r.initiated_by_id),
      })),
    );
  }

  /** Count of incoming pending requests — for the Requests badge. */
  async pendingRequestCount(meId: number): Promise<number> {
    const row = await this.conversations.manager.query<
      Array<{ total: number }>
    >(
      `
      SELECT COUNT(*)::int AS total
      FROM "chat_conversations" c
      WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
        AND c.status = 'pending'
        AND c.last_message_at IS NOT NULL
        AND c.initiated_by_id IS NOT NULL
        AND c.initiated_by_id <> $1
        AND NOT (CASE WHEN c.student_low_id = $1 THEN c.low_blocked ELSE c.high_blocked END)
      `,
      [meId],
    );
    return Number(row[0]?.total ?? 0);
  }

  /**
   * Conversations the caller has muted and/or blocked (any status) — the
   * "Blocked & muted" management list. This is also the ONLY place a request the
   * caller declined-by-block resurfaces (those are hidden from both the main
   * list and the Requests inbox), so it's how a block can be undone. Newest
   * activity first, then by name for rows with no messages.
   */
  async listRestricted(meId: number): Promise<ChatConversationSummary[]> {
    const rows = await this.conversations.manager.query<
      Array<{
        id: number;
        other_id: number;
        other_name: string;
        other_roll: string;
        other_photo_key: string | null;
        last_message_preview: string | null;
        last_message_at: Date | null;
        last_message_sender_id: number | null;
        other_last_read: string | null;
        unread: number;
        status: 'pending' | 'accepted';
        is_initiator: boolean;
        muted: boolean;
        blocked_by_me: boolean;
      }>
    >(
      `
      SELECT
        c.id,
        CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END AS other_id,
        s.display_name AS other_name,
        s.student_id   AS other_roll,
        ${VISIBLE_PHOTO_KEY('s')} AS other_photo_key,
        c.last_message_preview,
        c.last_message_at,
        c.last_message_sender_id,
        CASE WHEN c.student_low_id = $1 THEN c.high_last_read_message_id ELSE c.low_last_read_message_id END AS other_last_read,
        (SELECT COUNT(*) FROM "chat_messages" m
           WHERE m.conversation_id = c.id
             AND m.sender_id <> $1
             AND m.id > COALESCE(
               CASE WHEN c.student_low_id = $1 THEN c.low_last_read_message_id ELSE c.high_last_read_message_id END, 0))::int
          AS unread,
        c.status,
        (c.initiated_by_id = $1) AS is_initiator,
        (CASE WHEN c.student_low_id = $1 THEN c.low_muted   ELSE c.high_muted   END) AS muted,
        (CASE WHEN c.student_low_id = $1 THEN c.low_blocked ELSE c.high_blocked END) AS blocked_by_me
      FROM "chat_conversations" c
      JOIN "students" s
        ON s.id = (CASE WHEN c.student_low_id = $1 THEN c.student_high_id ELSE c.student_low_id END)
      WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
        AND (
          (CASE WHEN c.student_low_id = $1 THEN c.low_muted   ELSE c.high_muted   END)
          OR
          (CASE WHEN c.student_low_id = $1 THEN c.low_blocked ELSE c.high_blocked END)
        )
      ORDER BY c.last_message_at DESC NULLS LAST, s.display_name ASC
      `,
      [meId],
    );

    return Promise.all(
      rows.map(async (r) => ({
        id: Number(r.id),
        other: {
          id: Number(r.other_id),
          display_name: r.other_name,
          student_id: r.other_roll,
          photo_url: await this.photoUrl(r.other_photo_key),
        },
        last_message_preview: r.last_message_preview,
        last_message_at: r.last_message_at
          ? new Date(r.last_message_at).toISOString()
          : null,
        last_message_sender_id:
          r.last_message_sender_id != null
            ? Number(r.last_message_sender_id)
            : null,
        other_last_read_message_id:
          r.other_last_read != null ? Number(r.other_last_read) : null,
        unread: Number(r.unread),
        status: r.status,
        is_initiator: Boolean(r.is_initiator),
        muted: Boolean(r.muted),
        blocked_by_me: Boolean(r.blocked_by_me),
      })),
    );
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
        WHERE (c.student_low_id = $1 OR c.student_high_id = $1)
          AND (c.status = 'accepted' OR c.initiated_by_id = $1)
      ) sub
      `,
      [meId],
    );
    return Number(row[0]?.total ?? 0);
  }

  /**
   * A student's display name (one indexed PK lookup). Used by the gateway to
   * label the realtime `message:new` event so recipients can show an in-app
   * notification naming the sender. Falls back to a generic label if the row
   * has vanished (e.g. deactivated mid-conversation).
   */
  async displayName(studentId: number): Promise<string> {
    const rows = await this.messages.manager.query<
      Array<{ display_name: string }>
    >(`SELECT display_name FROM "students" WHERE id = $1`, [studentId]);
    return rows[0]?.display_name ?? 'Someone';
  }

  /**
   * Active groupmates the caller may start a chat with (excluding themselves),
   * name-ordered, with server-side search and offset pagination. `q` matches a
   * display name OR roll number (case-insensitive, wildcards escaped). `total`
   * is the full match count ignoring limit/offset, so the client knows when to
   * stop paging. Computed in one query via `COUNT(*) OVER()`.
   */
  async listContacts(
    meId: number,
    opts: { limit: number; offset: number; q?: string },
  ): Promise<ChatContactsPage> {
    const term = opts.q?.trim();
    // Escape LIKE wildcards so a literal "%" / "_" in the search isn't a wildcard.
    const like = term ? `%${term.replace(/[%_\\]/g, '\\$&')}%` : null;
    const rows = await this.studentGroups.manager.query<
      Array<{
        id: number;
        display_name: string;
        student_id: string;
        photo_key: string | null;
        total: string;
      }>
    >(
      `
      SELECT s.id, s.display_name, s.student_id,
             ${VISIBLE_PHOTO_KEY('s')} AS photo_key,
             COUNT(*) OVER() AS total
      FROM "student_groups" sg
      JOIN "students" s ON s.id = sg.student_id
      WHERE sg.attendance_group_id = (
              SELECT attendance_group_id FROM "student_groups" WHERE student_id = $1
            )
        AND sg.attendance_group_id IS NOT NULL
        AND s.id <> $1
        AND s.is_active = TRUE
        AND ($2::text IS NULL OR s.display_name ILIKE $2 OR s.student_id ILIKE $2)
      ORDER BY s.display_name ASC
      LIMIT $3 OFFSET $4
      `,
      [meId, like, opts.limit, opts.offset],
    );
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      items: await Promise.all(
        rows.map(async (r) => ({
          id: Number(r.id),
          display_name: r.display_name,
          student_id: r.student_id,
          photo_url: await this.photoUrl(r.photo_key),
        })),
      ),
    };
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
