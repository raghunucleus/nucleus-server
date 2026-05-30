import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { In, IsNull, Repository } from 'typeorm';
import { StudentNotification } from './entities/student-notification.entity';
import { StudentPushToken } from './entities/student-push-token.entity';
import { StudentNotificationsGateway } from './student-notification.gateway';
import type {
  SendStudentNotificationInput,
  StudentNotificationDto,
  StudentNotificationsPage,
} from './student-notification.types';

/** One OS-push delivery: a recipient plus the message/payload to send them. */
interface PushDelivery {
  studentId: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * The reusable, student-scoped notification API. Any student feature module
 * injects this and calls {@link send}; everything else (REST list, mark-read,
 * push-token management) backs the `student/notifications` endpoints.
 *
 * `send` persists the row(s) and emits the in-app socket event synchronously
 * (fast), then fires OS push as a detached, error-swallowed task so a slow or
 * unreachable Expo never blocks or fails the caller (a chat send, a cron, etc.).
 */
@Injectable()
export class StudentNotificationService {
  private readonly logger = new Logger('StudentNotificationService');
  // No access token needed for plain sends; set EXPO_ACCESS_TOKEN to enable
  // Expo's enhanced push security in production.
  private readonly expo = new Expo({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
  });

  constructor(
    @InjectRepository(StudentNotification)
    private readonly repo: Repository<StudentNotification>,
    @InjectRepository(StudentPushToken)
    private readonly tokens: Repository<StudentPushToken>,
    private readonly gateway: StudentNotificationsGateway,
  ) {}

  /**
   * Deliver a notification to one or many students. By default persists one row
   * per recipient, emits `notification:new` to each, and pushes to the OS only
   * for recipients with no live in-app socket; returns once persist + emit are
   * done (push runs detached).
   *
   * Pass `{ persist: false }` for **push-only** delivery: no row is stored and
   * no in-app event is emitted — just an OS push to offline recipients. Use this
   * for high-volume sources that have their own history/badge (e.g. chat), so
   * they don't bloat the notifications table or duplicate the in-app list.
   */
  async send(
    studentId: number | number[],
    input: SendStudentNotificationInput,
    opts: { persist?: boolean } = {},
  ): Promise<void> {
    const ids = [
      ...new Set(Array.isArray(studentId) ? studentId : [studentId]),
    ];
    if (ids.length === 0) return;

    const target = input.target ?? null;

    if (opts.persist === false) {
      const deliveries: PushDelivery[] = ids.map((id) => ({
        studentId: id,
        title: input.title,
        body: input.body,
        data: { module: input.module, type: input.type, target },
      }));
      // Fire-and-forget: push must never block or reject the caller.
      void this.pushToOffline(deliveries).catch((err) =>
        this.logger.error(`Push delivery failed: ${String(err)}`),
      );
      return;
    }

    const saved = await this.repo.save(
      ids.map((id) =>
        this.repo.create({
          student_id: id,
          module: input.module,
          type: input.type,
          title: input.title,
          body: input.body,
          target,
        }),
      ),
    );

    for (const row of saved) {
      this.gateway.emitToStudent(
        row.student_id,
        'notification:new',
        this.toDto(row),
      );
    }

    const deliveries: PushDelivery[] = saved.map((row) => ({
      studentId: row.student_id,
      title: row.title,
      body: row.body,
      data: {
        notificationId: row.id,
        module: row.module,
        type: row.type,
        target: row.target,
      },
    }));
    // Fire-and-forget: push must never block or reject the caller.
    void this.pushToOffline(deliveries).catch((err) =>
      this.logger.error(`Push delivery failed: ${String(err)}`),
    );
  }

  /** A page of the student's notifications, newest first, plus unread total. */
  async list(
    studentId: number,
    opts: { limit: number; before?: number; unread?: boolean },
  ): Promise<StudentNotificationsPage> {
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.student_id = :studentId', { studentId })
      .orderBy('n.id', 'DESC')
      .take(opts.limit + 1);
    if (opts.before) qb.andWhere('n.id < :before', { before: opts.before });
    if (opts.unread) qb.andWhere('n.read_at IS NULL');

    const rows = await qb.getMany();
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    return {
      items: page.map((n) => this.toDto(n)),
      has_more: hasMore,
      unread: await this.unreadCount(studentId),
    };
  }

  unreadCount(studentId: number): Promise<number> {
    return this.repo.count({
      where: { student_id: studentId, read_at: IsNull() },
    });
  }

  /** Mark one notification read. The student_id predicate enforces isolation. */
  async markRead(studentId: number, id: number): Promise<{ unread: number }> {
    await this.repo
      .createQueryBuilder()
      .update(StudentNotification)
      .set({ read_at: () => 'now()' })
      .where('id = :id AND student_id = :studentId AND read_at IS NULL', {
        id,
        studentId,
      })
      .execute();
    const unread = await this.unreadCount(studentId);
    this.gateway.emitToStudent(studentId, 'notification:unread', { unread });
    return { unread };
  }

  async markAllRead(studentId: number): Promise<{ unread: number }> {
    await this.repo
      .createQueryBuilder()
      .update(StudentNotification)
      .set({ read_at: () => 'now()' })
      .where('student_id = :studentId AND read_at IS NULL', { studentId })
      .execute();
    this.gateway.emitToStudent(studentId, 'notification:unread', { unread: 0 });
    return { unread: 0 };
  }

  /** Register (or refresh) one of the student's Expo push tokens — idempotent. */
  async registerPushToken(
    studentId: number,
    dto: { expoPushToken: string; platform?: string; deviceId?: string },
  ): Promise<void> {
    if (!Expo.isExpoPushToken(dto.expoPushToken)) {
      throw new BadRequestException('Invalid Expo push token.');
    }
    // Upsert on the token: reassigns student_id if the device moved, and bumps
    // last_seen_at. Safe to call on every app launch.
    await this.tokens.upsert(
      {
        student_id: studentId,
        expo_push_token: dto.expoPushToken,
        platform: dto.platform ?? null,
        device_id: dto.deviceId ?? null,
        last_seen_at: new Date(),
      },
      ['expo_push_token'],
    );
  }

  async unregisterPushToken(
    studentId: number,
    expoPushToken: string,
  ): Promise<void> {
    await this.tokens.delete({
      student_id: studentId,
      expo_push_token: expoPushToken,
    });
  }

  // --------------------------------------------------------------------------

  /**
   * Push the given deliveries to the OS for recipients with no live in-app
   * socket. Online recipients already saw the `notification:new` event (or, for
   * push-only sources, are using the app), so pushing them would double-notify.
   * Best-effort throughout: per-chunk errors are logged and skipped, and tokens
   * reported `DeviceNotRegistered` are pruned. `data` mirrors the in-app payload
   * so a tapped OS notification runs the same client route resolver.
   */
  private async pushToOffline(deliveries: PushDelivery[]): Promise<void> {
    const offline: PushDelivery[] = [];
    for (const d of deliveries) {
      if (!(await this.gateway.isOnline(d.studentId))) offline.push(d);
    }
    if (offline.length === 0) return;

    const studentIds = [...new Set(offline.map((d) => d.studentId))];
    const tokenRows = await this.tokens.find({
      where: { student_id: In(studentIds) },
    });
    if (tokenRows.length === 0) return;

    const tokensByStudent = new Map<number, string[]>();
    for (const t of tokenRows) {
      const list = tokensByStudent.get(t.student_id) ?? [];
      list.push(t.expo_push_token);
      tokensByStudent.set(t.student_id, list);
    }

    const messages: ExpoPushMessage[] = [];
    for (const d of offline) {
      for (const token of tokensByStudent.get(d.studentId) ?? []) {
        if (!Expo.isExpoPushToken(token)) continue;
        messages.push({
          to: token,
          title: d.title,
          body: d.body,
          sound: 'default',
          data: d.data,
        });
      }
    }
    if (messages.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of chunks) {
      try {
        tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
      } catch (err) {
        this.logger.warn(`Expo push chunk failed: ${String(err)}`);
      }
    }
    await this.pruneDeadTokens(messages, tickets);
  }

  /**
   * Tickets line up with `messages` order (chunks are sent and collected in
   * order), so a `DeviceNotRegistered` ticket identifies a dead token to delete.
   */
  private async pruneDeadTokens(
    messages: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    const dead: string[] = [];
    tickets.forEach((ticket, i) => {
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        const to = messages[i]?.to;
        if (typeof to === 'string') dead.push(to);
      }
    });
    if (dead.length > 0) {
      await this.tokens.delete({ expo_push_token: In(dead) });
    }
  }

  toDto(n: StudentNotification): StudentNotificationDto {
    return {
      id: n.id,
      module: n.module,
      type: n.type,
      title: n.title,
      body: n.body,
      target: n.target ?? null,
      read_at: n.read_at ? n.read_at.toISOString() : null,
      created_at: n.created_at.toISOString(),
    };
  }
}
