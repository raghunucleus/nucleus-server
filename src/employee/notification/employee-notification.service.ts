import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { In, IsNull, Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { MailService } from '../../mail/mail.service';
import { EmployeeNotificationPreference } from './entities/employee-notification-preference.entity';
import { EmployeeNotification } from './entities/employee-notification.entity';
import { EmployeePushToken } from './entities/employee-push-token.entity';
import { EmployeeNotificationsGateway } from './employee-notification.gateway';
import {
  EMPLOYEE_NOTIFICATION_MODULE_KEYS,
  EMPLOYEE_NOTIFICATION_MODULE_LABELS,
  type EmployeeNotificationDto,
  type EmployeeNotificationModuleKey,
  type EmployeeNotificationPreferenceDto,
  type EmployeeNotificationsPage,
  type SendEmployeeNotificationInput,
} from './employee-notification.types';

/** One OS-push delivery: a recipient plus the message/payload to send them. */
interface PushDelivery {
  employeeId: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  collapseKey?: string;
}

/** Effective per-module channel switches for one employee. */
interface ChannelPrefs {
  email_enabled: boolean;
  push_enabled: boolean;
}

/** No stored override means every channel is on. */
const DEFAULT_PREFS: ChannelPrefs = { email_enabled: true, push_enabled: true };

/**
 * The reusable, employee-scoped notification API. Any employee feature module
 * injects this and calls {@link send}; everything else (REST list, mark-read,
 * push-token management, preferences) backs the `employee/notifications`
 * endpoints.
 *
 * `send` persists the row(s) and emits the in-app socket event synchronously
 * (fast), then fires OS push and email as detached, error-swallowed tasks so a
 * slow Expo or a SendGrid outage never blocks or fails the caller (a student
 * submitting a request, a cron, etc.).
 *
 * Deliberately parallel to StudentNotificationService rather than a shared
 * generic: the two audiences have different tables, tokens, secrets and
 * channels (students get no email), and fusing them would put a student row one
 * mistyped generic away from an employee's inbox.
 */
@Injectable()
export class EmployeeNotificationService {
  private readonly logger = new Logger('EmployeeNotificationService');
  // No access token needed for plain sends; set EXPO_ACCESS_TOKEN to enable
  // Expo's enhanced push security in production.
  private readonly expo = new Expo({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
  });

  constructor(
    @InjectRepository(EmployeeNotification)
    private readonly repo: Repository<EmployeeNotification>,
    @InjectRepository(EmployeePushToken)
    private readonly tokens: Repository<EmployeePushToken>,
    @InjectRepository(EmployeeNotificationPreference)
    private readonly prefs: Repository<EmployeeNotificationPreference>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly gateway: EmployeeNotificationsGateway,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Deliver a notification to one or many employees. Persists one row per
   * recipient, emits `notification:new` to each, and — subject to that
   * employee's per-module preferences — fires an OS push and optionally an
   * email. Returns once persist + emit are done (push and email run detached).
   *
   * In-app is unconditional: it is the notification list itself, so it is not a
   * preference and never gated on socket presence.
   *
   * Pass `{ email: true }` to additionally send an email. Email is OPT-IN per
   * call site, not per module: a future high-volume trigger must have to ask
   * for the inbox rather than inherit it. Recipients who muted email for the
   * module are dropped even when the caller asks.
   *
   * Pass `{ persist: false }` for push-only delivery (no row, no in-app event),
   * for sources that keep their own history. Pass `collapseKey` to make
   * successive pushes REPLACE each other in the tray instead of stacking
   * (Android `tag` / iOS `apns-collapse-id`).
   */
  async send(
    employeeId: number | number[],
    input: SendEmployeeNotificationInput,
    opts: { persist?: boolean; collapseKey?: string; email?: boolean } = {},
  ): Promise<void> {
    const ids = [
      ...new Set(Array.isArray(employeeId) ? employeeId : [employeeId]),
    ];
    if (ids.length === 0) return;

    const target = input.target ?? null;
    // One query for the whole fan-out, not one per recipient.
    const prefsById = await this.prefsFor(ids, input.module);
    const pushIds = ids.filter((id) => this.prefOf(prefsById, id).push_enabled);

    if (opts.persist === false) {
      const deliveries: PushDelivery[] = pushIds.map((id) => ({
        employeeId: id,
        title: input.title,
        body: input.body,
        data: { module: input.module, type: input.type, target },
        collapseKey: opts.collapseKey,
      }));
      this.dispatchPush(deliveries);
      return;
    }

    const saved = await this.repo.save(
      ids.map((id) =>
        this.repo.create({
          employee_id: id,
          module: input.module,
          type: input.type,
          title: input.title,
          body: input.body,
          target,
        }),
      ),
    );

    for (const row of saved) {
      this.emit(row.employee_id, 'notification:new', this.toDto(row));
    }

    const pushable = new Set(pushIds);
    const deliveries: PushDelivery[] = saved
      .filter((row) => pushable.has(row.employee_id))
      .map((row) => ({
        employeeId: row.employee_id,
        title: row.title,
        body: row.body,
        data: {
          notificationId: row.id,
          module: row.module,
          type: row.type,
          target: row.target,
        },
        collapseKey: opts.collapseKey,
      }));
    this.dispatchPush(deliveries);

    if (opts.email) {
      const emailIds = ids.filter(
        (id) => this.prefOf(prefsById, id).email_enabled,
      );
      // Fire-and-forget: email must never block or reject the caller.
      void this.emailToEmployees(emailIds, input).catch((err) =>
        this.logger.error(`Email delivery failed: ${String(err)}`),
      );
    }
  }

  /** A page of the employee's notifications, newest first, plus unread total. */
  async list(
    employeeId: number,
    opts: { limit: number; before?: number; unread?: boolean },
  ): Promise<EmployeeNotificationsPage> {
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.employee_id = :employeeId', { employeeId })
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
      unread: await this.unreadCount(employeeId),
    };
  }

  unreadCount(employeeId: number): Promise<number> {
    return this.repo.count({
      where: { employee_id: employeeId, read_at: IsNull() },
    });
  }

  /** Mark one notification read. The employee_id predicate enforces isolation. */
  async markRead(employeeId: number, id: number): Promise<{ unread: number }> {
    await this.repo
      .createQueryBuilder()
      .update(EmployeeNotification)
      .set({ read_at: () => 'now()' })
      .where('id = :id AND employee_id = :employeeId AND read_at IS NULL', {
        id,
        employeeId,
      })
      .execute();
    const unread = await this.unreadCount(employeeId);
    this.emit(employeeId, 'notification:unread', { unread });
    return { unread };
  }

  async markAllRead(employeeId: number): Promise<{ unread: number }> {
    await this.repo
      .createQueryBuilder()
      .update(EmployeeNotification)
      .set({ read_at: () => 'now()' })
      .where('employee_id = :employeeId AND read_at IS NULL', { employeeId })
      .execute();
    this.emit(employeeId, 'notification:unread', { unread: 0 });
    return { unread: 0 };
  }

  /** Register (or refresh) one of the employee's Expo push tokens — idempotent. */
  async registerPushToken(
    employeeId: number,
    dto: { expoPushToken: string; platform?: string; deviceId?: string },
  ): Promise<void> {
    if (!Expo.isExpoPushToken(dto.expoPushToken)) {
      throw new BadRequestException('Invalid Expo push token.');
    }
    // Upsert on the token: reassigns employee_id if the device moved, and bumps
    // last_seen_at. Safe to call on every app launch.
    await this.tokens.upsert(
      {
        employee_id: employeeId,
        expo_push_token: dto.expoPushToken,
        platform: dto.platform ?? null,
        device_id: dto.deviceId ?? null,
        last_seen_at: new Date(),
      },
      ['expo_push_token'],
    );
  }

  async unregisterPushToken(
    employeeId: number,
    expoPushToken: string,
  ): Promise<void> {
    await this.tokens.delete({
      employee_id: employeeId,
      expo_push_token: expoPushToken,
    });
  }

  // --- preferences -----------------------------------------------------------

  /**
   * Every module with its effective switches — stored overrides layered over
   * the defaults. Returns the full list rather than just the stored rows so a
   * client can render the screen without knowing what the defaults are.
   */
  async getPreferences(
    employeeId: number,
  ): Promise<EmployeeNotificationPreferenceDto[]> {
    const rows = await this.prefs.find({ where: { employee_id: employeeId } });
    const byModule = new Map(rows.map((r) => [r.module_key, r]));
    return EMPLOYEE_NOTIFICATION_MODULE_KEYS.map((module) => {
      const row = byModule.get(module);
      return {
        module,
        label: EMPLOYEE_NOTIFICATION_MODULE_LABELS[module],
        email_enabled: row?.email_enabled ?? DEFAULT_PREFS.email_enabled,
        push_enabled: row?.push_enabled ?? DEFAULT_PREFS.push_enabled,
      };
    });
  }

  /**
   * Patch one module's switches. Upserts, so the first mute materialises the
   * row and later edits reuse it. Unspecified channels keep their current
   * effective value.
   */
  async setPreference(
    employeeId: number,
    moduleKey: EmployeeNotificationModuleKey,
    patch: { email_enabled?: boolean; push_enabled?: boolean },
  ): Promise<EmployeeNotificationPreferenceDto> {
    const existing = await this.prefs.findOne({
      where: { employee_id: employeeId, module_key: moduleKey },
    });
    const next: ChannelPrefs = {
      email_enabled:
        patch.email_enabled ??
        existing?.email_enabled ??
        DEFAULT_PREFS.email_enabled,
      push_enabled:
        patch.push_enabled ??
        existing?.push_enabled ??
        DEFAULT_PREFS.push_enabled,
    };
    await this.prefs.upsert(
      { employee_id: employeeId, module_key: moduleKey, ...next },
      ['employee_id', 'module_key'],
    );
    return {
      module: moduleKey,
      label: EMPLOYEE_NOTIFICATION_MODULE_LABELS[moduleKey],
      ...next,
    };
  }

  // --------------------------------------------------------------------------

  /**
   * Emit over the realtime socket, swallowing any failure.
   *
   * The socket is a nicety: the row is already durable and the client will see
   * it on the next fetch. But this runs BEFORE the push/email dispatch, so an
   * unguarded throw here would take the durable channels down with it — an
   * approver would silently lose the email for a request that is already
   * sitting in their queue. It also throws outright when no WebSocket server is
   * bound (a bare application context, e.g. a CLI script or a migration
   * runner), which must not make `send` unusable there.
   */
  private emit(employeeId: number, event: string, payload: unknown): void {
    try {
      this.gateway.emitToEmployee(employeeId, event, payload);
    } catch (err) {
      this.logger.warn(
        `Socket emit '${event}' to employee ${employeeId} failed: ${String(err)}`,
      );
    }
  }

  /** Stored overrides for these recipients in this module, keyed by employee. */
  private async prefsFor(
    employeeIds: number[],
    moduleKey: EmployeeNotificationModuleKey,
  ): Promise<Map<number, ChannelPrefs>> {
    const rows = await this.prefs.find({
      where: { employee_id: In(employeeIds), module_key: moduleKey },
    });
    return new Map(
      rows.map((r) => [
        r.employee_id,
        { email_enabled: r.email_enabled, push_enabled: r.push_enabled },
      ]),
    );
  }

  private prefOf(map: Map<number, ChannelPrefs>, id: number): ChannelPrefs {
    return map.get(id) ?? DEFAULT_PREFS;
  }

  /** Fire-and-forget: push must never block or reject the caller. */
  private dispatchPush(deliveries: PushDelivery[]): void {
    if (deliveries.length === 0) return;
    void this.pushToEmployees(deliveries).catch((err) =>
      this.logger.error(`Push delivery failed: ${String(err)}`),
    );
  }

  /**
   * Push the given deliveries to every registered device of each recipient.
   * Best-effort throughout: per-chunk errors are logged and skipped, and tokens
   * reported `DeviceNotRegistered` are pruned. `data` mirrors the in-app payload
   * so a tapped OS notification runs the same client route resolver.
   */
  private async pushToEmployees(deliveries: PushDelivery[]): Promise<void> {
    if (deliveries.length === 0) return;

    const employeeIds = [...new Set(deliveries.map((d) => d.employeeId))];
    const tokenRows = await this.tokens.find({
      where: { employee_id: In(employeeIds) },
    });
    if (tokenRows.length === 0) return;

    const tokensByEmployee = new Map<number, string[]>();
    for (const t of tokenRows) {
      const list = tokensByEmployee.get(t.employee_id) ?? [];
      list.push(t.expo_push_token);
      tokensByEmployee.set(t.employee_id, list);
    }

    const messages: ExpoPushMessage[] = [];
    for (const d of deliveries) {
      for (const token of tokensByEmployee.get(d.employeeId) ?? []) {
        if (!Expo.isExpoPushToken(token)) continue;
        messages.push({
          to: token,
          title: d.title,
          body: d.body,
          sound: 'default',
          data: d.data,
          // Same key → the OS replaces the displayed notification instead of
          // stacking a new one (`tag` is Android, `collapseId` is iOS).
          ...(d.collapseKey
            ? { tag: d.collapseKey, collapseId: d.collapseKey }
            : {}),
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

  /**
   * Email each recipient. Deactivated employees are skipped — their account
   * can't act on the notification, so mailing them is noise at best.
   *
   * Sent one at a time and caught per recipient: MailService rethrows a generic
   * failure, and one bad address must not sink the rest of the batch.
   */
  private async emailToEmployees(
    employeeIds: number[],
    input: SendEmployeeNotificationInput,
  ): Promise<void> {
    if (employeeIds.length === 0) return;

    const rows = await this.employees.find({
      where: { id: In(employeeIds), is_active: true },
      select: { id: true, email: true, emp_display_name: true },
    });
    if (rows.length === 0) return;

    const url = this.notificationsUrl();
    for (const emp of rows) {
      try {
        await this.mail.sendEmployeeNotification({
          to: emp.email,
          displayName: emp.emp_display_name,
          title: input.title,
          body: input.body,
          url,
        });
      } catch (err) {
        this.logger.warn(
          `Notification email to employee ${emp.id} failed: ${String(err)}`,
        );
      }
    }
  }

  /**
   * The link an email points at: the employee's notification inbox, never a
   * per-target deep link. The server does not know client routes — that's the
   * whole point of the module/target registry — so it links to the one page
   * that can resolve any notification, and the click-through does the routing.
   *
   * Built through `URL` rather than concatenation because EMPLOYEE_APP_URL can
   * carry a baked-in query string (e.g. `?app=employee` on the shared dev port)
   * that must survive.
   */
  private notificationsUrl(): string {
    const base = this.config.get<string>(
      'EMPLOYEE_APP_URL',
      'http://localhost:5000',
    );
    const url = new URL(base);
    url.pathname = '/notifications';
    return url.toString();
  }

  toDto(n: EmployeeNotification): EmployeeNotificationDto {
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
