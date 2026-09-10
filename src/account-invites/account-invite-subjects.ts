import { ConfigService } from '@nestjs/config';
import {
  EntityManager,
  EntityTarget,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';
import { Employee } from '../admin/entities/employee.entity';
import { Student } from '../admin/entities/student.entity';
import { parseDurationToSeconds } from '../common/parse-duration';
import { EmployeeCredential } from '../employee/auth/entities/employee-credential.entity';
import { MailService } from '../mail/mail.service';
import { StudentCredential } from '../student/entities/student-credential.entity';
import type { InviteSubjectType } from './entities/account-invite.entity';

/** Everything the invite flow needs to know about one person, either audience. */
export interface InviteRecipient {
  id: number;
  /** Name to greet them by, in the email and on the set-password screen. */
  display_name: string;
  /** What they type to log in — emp_code or student_id. */
  identifier: string;
  email: string;
  is_active: boolean;
}

/** A credential row, narrowed to the columns the invite flow reads or writes. */
export interface InviteCredential {
  password_hash: string | null;
  must_change_password: boolean;
  password_changed_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
}

/**
 * The three-point seam between employees and students.
 *
 * Everything else about an invite — the token, the table, the consume
 * transaction, the bulk loop, the status derivation — is identical for both
 * audiences, so the service is written once against this interface rather than
 * mirrored the way the two auth services are.
 */
export interface SubjectAdapter {
  type: InviteSubjectType;
  /** Table names, needed by the raw status query. */
  subjectTable: 'employees' | 'students';
  credentialTable: 'employee_credentials' | 'student_credentials';
  credentialFk: 'employee_id' | 'student_id';
  /** Human label used in admin-facing error copy. */
  label: 'employee' | 'student';

  load(m: EntityManager, id: number): Promise<InviteRecipient | null>;
  loadMany(m: EntityManager, ids: number[]): Promise<InviteRecipient[]>;
  getOrCreateCredential(
    m: EntityManager,
    id: number,
  ): Promise<InviteCredential>;
  /** Ids matching a whole-batch filter, before any invite-status narrowing. */
  batchIds(m: EntityManager, filter: BatchFilter): Promise<number[]>;

  /** Portal URL with the invite token merged into the query string. */
  inviteUrl(token: string): string;
  ttlSeconds(): number;
  sendInvite(
    r: InviteRecipient,
    url: string,
    expiresInDays: number,
  ): Promise<void>;
}

export type BatchFilter =
  | { programme_id: number; admission_year_id: number }
  | { department_id: number };

/**
 * Merge query params onto a configured portal base URL.
 *
 * Uses `URL` + `searchParams.set` rather than string concatenation so a base
 * that already carries a query string survives — `EMPLOYEE_APP_URL` in dev is
 * `http://localhost:5000?app=employee`, and appending `?invite-token=` to that
 * would produce a URL the portal cannot read.
 */
function buildAppUrl(
  base: string,
  extraSearchParams: Record<string, string>,
): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(extraSearchParams)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export function createEmployeeAdapter(
  config: ConfigService,
  mail: MailService,
): SubjectAdapter {
  return {
    type: 'employee',
    subjectTable: 'employees',
    credentialTable: 'employee_credentials',
    credentialFk: 'employee_id',
    label: 'employee',

    async load(m, id) {
      const e = await m.getRepository(Employee).findOne({ where: { id } });
      return e ? toEmployeeRecipient(e) : null;
    },

    async loadMany(m, ids) {
      if (ids.length === 0) return [];
      const rows = await m
        .getRepository(Employee)
        .createQueryBuilder('e')
        .where('e.id IN (:...ids)', { ids })
        .getMany();
      return rows.map(toEmployeeRecipient);
    },

    getOrCreateCredential: (m, id) =>
      getOrCreateCredential(m, EmployeeCredential, 'employee_id', id),

    async batchIds(m, filter) {
      if (!('department_id' in filter)) return [];
      const rows = await m
        .getRepository(Employee)
        .createQueryBuilder('e')
        .select('e.id', 'id')
        .where('e.department_id = :dept', { dept: filter.department_id })
        .andWhere('e.is_active = true')
        .orderBy('e.id', 'ASC')
        .getRawMany<{ id: number }>();
      return rows.map((r) => Number(r.id));
    },

    inviteUrl: (token) =>
      buildAppUrl(
        config.get<string>('EMPLOYEE_APP_URL', 'http://localhost:5000'),
        {
          'invite-token': token,
        },
      ),

    ttlSeconds: () =>
      parseDurationToSeconds(
        config.get<string>('EMPLOYEE_ACCOUNT_INVITE_TTL', '7d'),
        7 * 86400,
      ),

    sendInvite: (r, url, expiresInDays) =>
      mail.sendEmployeeInvite({
        to: r.email,
        displayName: r.display_name,
        empCode: r.identifier,
        inviteUrl: url,
        expiresInDays,
      }),
  };
}

export function createStudentAdapter(
  config: ConfigService,
  mail: MailService,
): SubjectAdapter {
  return {
    type: 'student',
    subjectTable: 'students',
    credentialTable: 'student_credentials',
    credentialFk: 'student_id',
    label: 'student',

    async load(m, id) {
      const s = await m.getRepository(Student).findOne({ where: { id } });
      return s ? toStudentRecipient(s) : null;
    },

    async loadMany(m, ids) {
      if (ids.length === 0) return [];
      const rows = await m
        .getRepository(Student)
        .createQueryBuilder('s')
        .where('s.id IN (:...ids)', { ids })
        .getMany();
      return rows.map(toStudentRecipient);
    },

    getOrCreateCredential: (m, id) =>
      getOrCreateCredential(m, StudentCredential, 'student_id', id),

    async batchIds(m, filter) {
      if (!('programme_id' in filter)) return [];
      const rows = await m
        .getRepository(Student)
        .createQueryBuilder('s')
        .select('s.id', 'id')
        .where('s.programme_id = :prog', { prog: filter.programme_id })
        .andWhere('s.admission_year_id = :year', {
          year: filter.admission_year_id,
        })
        .andWhere('s.is_active = true')
        .orderBy('s.id', 'ASC')
        .getRawMany<{ id: number }>();
      return rows.map((r) => Number(r.id));
    },

    inviteUrl: (token) =>
      buildAppUrl(
        config.get<string>('STUDENT_APP_URL', 'http://localhost:5000'),
        {
          'invite-token': token,
        },
      ),

    ttlSeconds: () =>
      parseDurationToSeconds(
        config.get<string>('STUDENT_ACCOUNT_INVITE_TTL', '7d'),
        7 * 86400,
      ),

    sendInvite: (r, url, expiresInDays) =>
      mail.sendStudentInvite({
        to: r.email,
        displayName: r.display_name,
        studentId: r.identifier,
        inviteUrl: url,
        expiresInDays,
      }),
  };
}

function toEmployeeRecipient(e: Employee): InviteRecipient {
  return {
    id: e.id,
    display_name: e.emp_display_name,
    identifier: e.emp_code,
    email: (e.email ?? '').trim(),
    is_active: e.is_active,
  };
}

function toStudentRecipient(s: Student): InviteRecipient {
  return {
    id: s.id,
    display_name: s.display_name,
    identifier: s.student_id,
    email: (s.email ?? '').trim(),
    is_active: s.is_active,
  };
}

/**
 * Mirrors `getOrCreateCredential` in the two auth services, but runs on the
 * caller's EntityManager so it can join the invite-accept transaction.
 *
 * The insert can lose a race with a concurrent login, so a failure falls back
 * to re-reading rather than surfacing — the unique constraint on the FK column
 * is what makes that safe.
 */
async function getOrCreateCredential<
  T extends InviteCredential & ObjectLiteral,
>(
  m: EntityManager,
  entity: EntityTarget<T>,
  fk: 'employee_id' | 'student_id',
  subjectId: number,
): Promise<T> {
  const repo = m.getRepository(entity);
  const where = { [fk]: subjectId } as FindOptionsWhere<T>;

  const existing = await repo.findOne({ where });
  if (existing) return existing;

  const draft = repo.create();
  Object.assign(draft, {
    [fk]: subjectId,
    password_hash: null,
    must_change_password: true,
    failed_login_attempts: 0,
  });

  try {
    return await repo.save(draft);
  } catch {
    const row = await repo.findOne({ where });
    if (row) return row;
    throw new Error(`Could not initialise credentials for ${fk} ${subjectId}`);
  }
}
