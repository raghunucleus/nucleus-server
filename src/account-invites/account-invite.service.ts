import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { parseDurationToSeconds } from '../common/parse-duration';
import { revokeAllSessions } from '../common/session-keys';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  BatchFilter,
  InviteRecipient,
  SubjectAdapter,
  createEmployeeAdapter,
  createStudentAdapter,
} from './account-invite-subjects';
import {
  AccountInvite,
  InviteSubjectType,
} from './entities/account-invite.entity';

const BCRYPT_ROUNDS = 12;

/** Concurrent in-flight SendGrid calls during a bulk send. */
const SEND_CONCURRENCY = 8;

/**
 * The one message every failed token lookup produces, whatever the real
 * reason. Mirrors the reset-password copy.
 */
const INVALID_INVITE = 'This invitation link is invalid or has expired.';

const RATE_LIMITS = {
  /** Opening the set-password screen. Generous — a refresh must not lock anyone out. */
  validate: { max: 60, windowSeconds: 3600 },
  /** Submitting a password. Matches the reset-password limit. */
  accept: { max: 30, windowSeconds: 3600 },
} as const;

export type AccountStatusKind =
  | 'not_invited'
  | 'invited'
  | 'expired'
  | 'active';

export interface AccountStatusView {
  status: AccountStatusKind;
  invited_at: string | null;
  expires_at: string | null;
  resend_count: number;
  last_login_at: string | null;
}

export type SkipReason =
  | 'already_active'
  | 'no_email'
  | 'inactive'
  | 'cooldown'
  | 'outstanding_invite'
  | 'not_found';

export interface SendInvitesInput {
  subject_type: InviteSubjectType;
  subject_ids?: number[];
  filter?: BatchFilter;
  only_uninvited: boolean;
  resend: boolean;
}

export interface SendInvitesResult {
  requested: number;
  sent: number;
  skipped: { subject_id: number; identifier: string; reason: SkipReason }[];
  failed: {
    subject_id: number;
    identifier: string;
    email: string;
    message: string;
  }[];
}

export interface InvitePreviewRow {
  id: number;
  display_name: string;
  identifier: string;
  email: string;
  account_status: AccountStatusKind;
}

export interface InviteHistoryRow {
  id: number;
  email: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  resend_count: number;
  invited_by: { id: number; display_name: string } | null;
}

export type ValidateInviteResult =
  | {
      valid: true;
      subject_type: InviteSubjectType;
      display_name: string;
      login_identifier: string;
      email_masked: string;
      expires_at: string;
    }
  | { valid: false; reason: 'expired' | 'invalid' };

/**
 * Account invitations for both employees and students.
 *
 * Written once against `SubjectAdapter` rather than mirrored per audience:
 * everything here — the token, the consume transaction, the bulk loop, the
 * status derivation — is byte-identical for the two, so a second copy would
 * only guarantee drift.
 *
 * Deliberately does NOT depend on `EmployeeAuthService` / `StudentAuthService`.
 * `AdminModule` already imports both, and this service is imported by
 * `AdminModule` in turn, so reaching back into them would close a module
 * cycle. It holds the credential repositories directly and revokes sessions
 * through the shared `revokeAllSessions` helper, which is why that helper
 * exists rather than a third copy of the key format.
 */
@Injectable()
export class AccountInviteService {
  private readonly logger = new Logger(AccountInviteService.name);
  private readonly adapters: Record<InviteSubjectType, SubjectAdapter>;

  constructor(
    @InjectRepository(AccountInvite)
    private readonly invites: Repository<AccountInvite>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.adapters = {
      employee: createEmployeeAdapter(config, mail),
      student: createStudentAdapter(config, mail),
    };
  }

  // ---------------------------------------------------------------------------
  // Status derivation
  // ---------------------------------------------------------------------------

  /**
   * Account status for a page of subjects, in one query.
   *
   * `LEFT JOIN LATERAL` picks the latest invite per subject with a single index
   * scan, so a 100-row admin list costs one extra query rather than 100.
   *
   * An account counts as active when it has EITHER a password hash OR a linked
   * Google id. Ignoring `google_id` would make "invite everyone uninvited"
   * email people who have been signing in with Google for months.
   */
  async getStatuses(
    subjectType: InviteSubjectType,
    ids: number[],
  ): Promise<Record<number, AccountStatusView>> {
    if (ids.length === 0) return {};
    const a = this.adapters[subjectType];

    // Table and column names come from the adapter's closed set, never from a
    // request; only `ids` and the subject type are parameterised values.
    const rows = await this.dataSource.query<
      {
        subject_id: number;
        is_active_account: boolean;
        last_login_at: Date | null;
        invited_at: Date | null;
        expires_at: Date | null;
        accepted_at: Date | null;
        revoked_at: Date | null;
        resend_count: number | null;
        is_expired: boolean | null;
      }[]
    >(
      `SELECT s.id AS subject_id,
              (c.password_hash IS NOT NULL OR c.google_id IS NOT NULL) AS is_active_account,
              c.last_login_at,
              i.created_at AS invited_at,
              i.expires_at,
              i.accepted_at,
              i.revoked_at,
              i.resend_count,
              (i.expires_at IS NOT NULL AND i.expires_at <= now()) AS is_expired
       FROM "${a.subjectTable}" s
       LEFT JOIN "${a.credentialTable}" c ON c."${a.credentialFk}" = s.id
       LEFT JOIN LATERAL (
         SELECT ai.* FROM "account_invites" ai
         WHERE ai.subject_type = $1 AND ai.subject_id = s.id
         ORDER BY ai.created_at DESC, ai.id DESC
         LIMIT 1
       ) i ON TRUE
       WHERE s.id = ANY($2::int[])`,
      [a.type, ids],
    );

    const out: Record<number, AccountStatusView> = {};
    for (const r of rows) {
      out[Number(r.subject_id)] = {
        status: deriveStatus(r),
        invited_at: iso(r.invited_at),
        expires_at: iso(r.expires_at),
        resend_count: Number(r.resend_count ?? 0),
        last_login_at: iso(r.last_login_at),
      };
    }
    // Ids with no subject row still get an entry, so callers never hit undefined.
    for (const id of ids) {
      out[id] ??= {
        status: 'not_invited',
        invited_at: null,
        expires_at: null,
        resend_count: 0,
        last_login_at: null,
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * Send invitations to an explicit id list or to a whole filtered batch.
   *
   * Resolves 200 even when individual recipients fail: an admin who has just
   * mailed 190 of 200 people needs the summary far more than they need an HTTP
   * error code. Only a wholesale precondition failure throws.
   */
  async sendInvites(
    input: SendInvitesInput,
    adminId: number | null,
  ): Promise<SendInvitesResult> {
    const a = this.adapters[input.subject_type];

    const ids = input.subject_ids?.length
      ? dedupe(input.subject_ids)
      : await this.resolveBatchIds(a, input.filter);

    const maxBatch = this.maxBatch();
    if (ids.length > maxBatch) {
      throw new BadRequestException(
        `This batch has ${ids.length} recipients, over the ${maxBatch} limit. ` +
          'Narrow the filter or send in smaller batches.',
      );
    }

    const result: SendInvitesResult = {
      requested: ids.length,
      sent: 0,
      skipped: [],
      failed: [],
    };
    if (ids.length === 0) return result;

    const [recipients, statuses] = await Promise.all([
      a.loadMany(this.dataSource.manager, ids),
      this.getStatuses(a.type, ids),
    ]);
    const byId = new Map(recipients.map((r) => [r.id, r]));

    // Partition before touching the mail layer, so a blank-email row never
    // costs a SendGrid call and never creates an invite row.
    const sendable: InviteRecipient[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        result.skipped.push({
          subject_id: id,
          identifier: String(id),
          reason: 'not_found',
        });
        continue;
      }
      const reason = this.skipReason(r, statuses[id], input);
      if (reason) {
        result.skipped.push({
          subject_id: id,
          identifier: r.identifier,
          reason,
        });
        continue;
      }
      sendable.push(r);
    }

    const ttlSeconds = a.ttlSeconds();
    const expiresInDays = Math.max(1, Math.round(ttlSeconds / 86400));

    const outcomes = await runBounded(sendable, SEND_CONCURRENCY, (r) =>
      this.sendOne(a, r, adminId, ttlSeconds, expiresInDays),
    );

    for (const o of outcomes) {
      if (o.ok) result.sent += 1;
      else result.failed.push(o.failure);
    }
    return result;
  }

  /**
   * One recipient: create the row, then send.
   *
   * Order matters. Sending first and crashing before the insert would put a
   * token in someone's inbox with no row behind it — a permanently dead link
   * with no diagnostic trail. Writing first means the worst case is a live row
   * whose email never left, which the catch below revokes so it cannot show up
   * as "Invited" in the admin list.
   */
  private async sendOne(
    a: SubjectAdapter,
    r: InviteRecipient,
    adminId: number | null,
    ttlSeconds: number,
    expiresInDays: number,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        failure: SendInvitesResult['failed'][number];
      }
  > {
    let inviteId: number | null = null;
    try {
      const created = await this.createInviteRow(a, r, adminId, ttlSeconds);
      inviteId = created.id;
      await a.sendInvite(r, a.inviteUrl(created.token), expiresInDays);
      return { ok: true };
    } catch (err) {
      if (inviteId !== null) {
        await this.invites
          .update(inviteId, { revoked_at: new Date() })
          .catch(() => undefined);
      }
      this.logger.error(
        `Invite send failed for ${a.type} ${r.id}: ${messageOf(err)}`,
      );
      return {
        ok: false,
        failure: {
          subject_id: r.id,
          identifier: r.identifier,
          email: r.email,
          message: 'Email delivery failed',
        },
      };
    }
  }

  /**
   * Insert a fresh invite and kill any earlier outstanding one, atomically —
   * a person must never hold two live links.
   */
  private async createInviteRow(
    a: SubjectAdapter,
    r: InviteRecipient,
    adminId: number | null,
    ttlSeconds: number,
  ): Promise<{ id: number; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const token_hash = hashToken(token);
    const expires_at = new Date(Date.now() + ttlSeconds * 1000);

    const id = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(AccountInvite);
      await repo
        .createQueryBuilder()
        .update(AccountInvite)
        .set({ revoked_at: () => 'now()' })
        .where('subject_type = :t AND subject_id = :id', {
          t: a.type,
          id: r.id,
        })
        .andWhere('accepted_at IS NULL')
        .andWhere('revoked_at IS NULL')
        .execute();

      const priorCount = await repo.count({
        where: { subject_type: a.type, subject_id: r.id },
      });

      const row = await repo.save(
        repo.create({
          subject_type: a.type,
          subject_id: r.id,
          email: r.email,
          token_hash,
          expires_at,
          resend_count: priorCount,
          invited_by_admin_id: adminId,
        }),
      );
      return row.id;
    });

    return { id, token };
  }

  private skipReason(
    r: InviteRecipient,
    status: AccountStatusView | undefined,
    input: SendInvitesInput,
  ): SkipReason | null {
    if (!r.is_active) return 'inactive';
    if (!r.email) return 'no_email';
    if (!status) return null;

    if (status.status === 'active' && input.only_uninvited) {
      return 'already_active';
    }
    if (status.status === 'invited' && !input.resend) {
      return 'outstanding_invite';
    }
    // A double-clicked "send batch" must not mail anyone twice. An expired
    // invite is by definition older than the cooldown, so this only ever
    // catches genuinely recent sends.
    if (status.invited_at) {
      const age = Date.now() - new Date(status.invited_at).getTime();
      if (age < this.resendCooldownSeconds() * 1000) return 'cooldown';
    }
    return null;
  }

  /** Ids matching a whole-batch filter. Throws when the filter is absent. */
  private async resolveBatchIds(
    a: SubjectAdapter,
    filter: BatchFilter | undefined,
  ): Promise<number[]> {
    if (!filter) {
      throw new BadRequestException(
        'Provide either subject_ids or a batch filter.',
      );
    }
    return a.batchIds(this.dataSource.manager, filter);
  }

  /**
   * What a whole-batch send would do, without doing it — the count plus a
   * sample, so nobody fires 200 emails blind.
   */
  async previewBatch(
    subjectType: InviteSubjectType,
    filter: BatchFilter,
    onlyUninvited: boolean,
  ): Promise<{ total: number; sample: InvitePreviewRow[] }> {
    const a = this.adapters[subjectType];
    const ids = await this.resolveBatchIds(a, filter);
    if (ids.length === 0) return { total: 0, sample: [] };

    const statuses = await this.getStatuses(a.type, ids);
    const eligible = onlyUninvited
      ? ids.filter((id) => statuses[id]?.status !== 'active')
      : ids;

    const sample = await a.loadMany(
      this.dataSource.manager,
      eligible.slice(0, 10),
    );
    return {
      total: eligible.length,
      sample: sample.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        identifier: r.identifier,
        email: r.email,
        account_status: statuses[r.id]?.status ?? 'not_invited',
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Public token flow
  // ---------------------------------------------------------------------------

  /**
   * Look up an invite so the set-password screen can greet the person by name.
   *
   * Never throws for a bad token — an expired invite is a state to render, not
   * an error. Nothing here is enumerable: the only input is a 256-bit token,
   * so telling apart "expired" from "invalid" leaks nothing while being the
   * difference between someone who calls the office and someone who gives up.
   */
  async validateToken(
    token: string,
    ip?: string,
  ): Promise<ValidateInviteResult> {
    await this.enforceRateLimit('validate', ip, RATE_LIMITS.validate);

    const invite = await this.invites.findOne({
      where: { token_hash: hashToken(token) },
    });
    if (!invite || invite.accepted_at || invite.revoked_at) {
      return { valid: false, reason: 'invalid' };
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      return { valid: false, reason: 'expired' };
    }

    const a = this.adapters[invite.subject_type];
    const subject = await a.load(this.dataSource.manager, invite.subject_id);
    if (!subject || !subject.is_active) {
      return { valid: false, reason: 'invalid' };
    }

    return {
      valid: true,
      subject_type: invite.subject_type,
      display_name: subject.display_name,
      login_identifier: subject.identifier,
      email_masked: maskEmail(invite.email),
      expires_at: invite.expires_at.toISOString(),
    };
  }

  /**
   * Burn the token and set the password.
   *
   * The guarded UPDATE is what makes the invite single-use: two parallel
   * submissions of the same token race on `accepted_at IS NULL`, and exactly
   * one wins. Expiry is compared inside SQL rather than against a JS Date —
   * `expires_at` is a `timestamp` without time zone, so a client-side
   * comparison would drift by the server's offset.
   */
  async acceptInvite(
    token: string,
    newPassword: string,
    ip?: string,
  ): Promise<{ subject_type: InviteSubjectType }> {
    await this.enforceRateLimit('accept', ip, RATE_LIMITS.accept);
    const hash = hashToken(token);

    const consumed = await this.dataSource.transaction(async (m) => {
      const res = await m
        .createQueryBuilder()
        .update(AccountInvite)
        .set({ accepted_at: () => 'now()' })
        .where('token_hash = :hash', { hash })
        .andWhere('accepted_at IS NULL')
        .andWhere('revoked_at IS NULL')
        .andWhere('expires_at > now()')
        .returning(['id', 'subject_type', 'subject_id'])
        .execute();

      const raw = res.raw as {
        subject_type: InviteSubjectType;
        subject_id: number;
      }[];
      if ((res.affected ?? 0) !== 1 || raw.length !== 1) {
        throw new BadRequestException(INVALID_INVITE);
      }
      const row = raw[0];
      const a = this.adapters[row.subject_type];

      // Re-checked inside the transaction: someone can be deactivated between
      // the send and the click, and the polymorphic subject_id has no FK to
      // guarantee the row still exists. Throwing here rolls the accept back,
      // so the token is not silently burned.
      const subject = await a.load(m, Number(row.subject_id));
      if (!subject || !subject.is_active) {
        throw new BadRequestException(INVALID_INVITE);
      }

      const cred = await a.getOrCreateCredential(m, subject.id);
      cred.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      // The credential row defaults `must_change_password` to true; leaving it
      // would bounce the person into the forced-change screen holding the
      // password they just chose.
      cred.must_change_password = false;
      cred.password_changed_at = new Date();
      cred.failed_login_attempts = 0;
      cred.locked_until = null;
      await m.save(cred);

      return { adapter: a, subjectId: subject.id };
    });

    // Outside the transaction, exactly like resetPassword: a Redis failure
    // must not roll back a password the person has already been told is set.
    await revokeAllSessions(
      this.redis,
      consumed.adapter.redisFamilyPrefix,
      consumed.subjectId,
    );

    return { subject_type: consumed.adapter.type };
  }

  // ---------------------------------------------------------------------------
  // Admin reads / revocation
  // ---------------------------------------------------------------------------

  async listForSubject(
    subjectType: InviteSubjectType,
    subjectId: number,
  ): Promise<InviteHistoryRow[]> {
    const rows = await this.invites.find({
      where: { subject_type: subjectType, subject_id: subjectId },
      relations: { invited_by_admin: true },
      order: { created_at: 'DESC', id: 'DESC' },
      take: 50,
    });

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      created_at: r.created_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
      accepted_at: iso(r.accepted_at),
      revoked_at: iso(r.revoked_at),
      resend_count: r.resend_count,
      invited_by: r.invited_by_admin
        ? {
            id: Number(r.invited_by_admin.id),
            display_name:
              r.invited_by_admin.display_name ?? r.invited_by_admin.username,
          }
        : null,
    }));
  }

  /**
   * Kill every outstanding invite for one person.
   *
   * Also called from the admin set/reset-password paths: without it, an admin
   * who mails a temporary password while an invite is outstanding leaves a
   * live token that would silently overwrite that password days later.
   */
  async revokeOutstanding(
    subjectType: InviteSubjectType,
    subjectId: number,
  ): Promise<void> {
    await this.invites
      .createQueryBuilder()
      .update(AccountInvite)
      .set({ revoked_at: () => 'now()' })
      .where('subject_type = :t AND subject_id = :id', {
        t: subjectType,
        id: subjectId,
      })
      .andWhere('accepted_at IS NULL')
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private maxBatch(): number {
    const raw = Number(this.config.get<string>('ACCOUNT_INVITE_MAX_BATCH', ''));
    return Number.isFinite(raw) && raw > 0 ? raw : 500;
  }

  private resendCooldownSeconds(): number {
    return parseDurationToSeconds(
      this.config.get<string>('ACCOUNT_INVITE_RESEND_COOLDOWN', '5m'),
      300,
    );
  }

  /** Mirrors the auth services' Redis counter, in its own key namespace. */
  private async enforceRateLimit(
    bucket: string,
    subject: string | undefined,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    if (!subject) return;
    const key = `invite:rl:${bucket}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, limit.windowSeconds);
    }
    if (count > limit.max) {
      throw new HttpException(
        'Too many requests. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * SendGrid calls are serial and slow (150–800 ms each); 8 at a time turns a
 * 200-recipient batch from minutes into seconds while leaving the event loop
 * and the connection pool room to serve other requests.
 */
async function runBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

function deriveStatus(row: {
  is_active_account: boolean;
  invited_at: Date | null;
  revoked_at: Date | null;
  is_expired: boolean | null;
}): AccountStatusKind {
  if (row.is_active_account) return 'active';
  if (!row.invited_at || row.revoked_at) return 'not_invited';
  if (row.is_expired) return 'expired';
  return 'invited';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function dedupe(ids: number[]): number[] {
  return [...new Set(ids)];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

/** `priya.sharma@example.com` → `pr•••@example.com`. Enough to recognise, not to harvest. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}•••${domain}`;
}
