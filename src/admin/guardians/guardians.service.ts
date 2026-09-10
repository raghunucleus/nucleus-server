import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { z } from 'zod';
import {
  AuthSessionsService,
  SessionRow,
} from '../../auth-sessions/auth-sessions.service';
import { GuardianAuthService } from '../../guardian/guardian-auth.service';
import {
  GuardianRelationship,
  StudentGuardian,
} from '../../guardian/entities/student-guardian.entity';
import type { GuardiansSortField } from '../dto/list-guardians.dto';
import { Student } from '../entities/student.entity';

const MOBILE_RE = /^[6-9]\d{9}$/;
const emailParser = z.string().email();

export interface GuardianRowError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface GuardianContactItem {
  id: number;
  student_id: number;
  student_roll: string;
  student_name: string;
  relationship: string;
  name: string;
  mobile_number: string;
  email: string | null;
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ListGuardiansResult {
  rows: GuardianContactItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface BulkUploadResult {
  contacts_upserted: number;
  students_affected: number;
  warnings: GuardianRowError[];
}

export interface BulkUploadGuardianRow {
  student_id: string;
  father_name?: string;
  father_mobile?: string;
  father_email?: string;
  mother_name?: string;
  mother_mobile?: string;
  mother_email?: string;
  guardian_name?: string;
  guardian_mobile?: string;
  guardian_email?: string;
}

const SORT_COLUMN: Record<GuardiansSortField, string> = {
  name: 'name',
  mobile_number: 'mobile_number',
  relationship: 'relationship',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

type BulkRole = 'father' | 'mother' | 'guardian';

interface Contact {
  rowIndex: number;
  role: BulkRole;
  name: string;
  mobile: string;
  email: string | null;
}

@Injectable()
export class GuardiansService {
  constructor(
    @InjectRepository(StudentGuardian)
    private readonly contacts: Repository<StudentGuardian>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guardianAuth: GuardianAuthService,
    private readonly sessions: AuthSessionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: GuardiansSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    mobileSearch?: string;
    studentSearch?: string;
  }): Promise<ListGuardiansResult> {
    const qb = this.contacts
      .createQueryBuilder('sg')
      .innerJoin('sg.student', 's')
      .select([
        'sg.id AS id',
        'sg.student_id AS student_id',
        's.student_id AS student_roll',
        's.display_name AS student_name',
        'sg.relationship AS relationship',
        'sg.name AS name',
        'sg.mobile_number AS mobile_number',
        'sg.email AS email',
        'sg.is_primary AS is_primary',
        'sg.created_at AS created_at',
        'sg.updated_at AS updated_at',
      ]);

    if (opts.nameSearch) {
      qb.andWhere('LOWER(sg.name) LIKE :n', {
        n: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }
    if (opts.mobileSearch) {
      qb.andWhere('sg.mobile_number LIKE :m', { m: `%${opts.mobileSearch}%` });
    }
    if (opts.studentSearch) {
      qb.andWhere('LOWER(s.student_id) LIKE :sr', {
        sr: `%${opts.studentSearch.toLowerCase()}%`,
      });
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const countQb = qb.clone();
    const total = await countQb.getCount();

    qb.orderBy(`sg.${SORT_COLUMN[opts.sortBy]}`, direction)
      .addOrderBy('sg.id', 'ASC')
      .offset((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize);

    const raw = await qb.getRawMany<{
      id: number;
      student_id: number;
      student_roll: string;
      student_name: string;
      relationship: string;
      name: string;
      mobile_number: string;
      email: string | null;
      is_primary: boolean;
      created_at: Date;
      updated_at: Date;
    }>();

    return {
      rows: raw.map((r) => ({
        id: Number(r.id),
        student_id: Number(r.student_id),
        student_roll: r.student_roll,
        student_name: r.student_name,
        relationship: r.relationship,
        name: r.name,
        mobile_number: r.mobile_number,
        email: r.email,
        is_primary: r.is_primary,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  /** All guardian contacts for one student. */
  async listForStudent(studentId: number): Promise<StudentGuardian[]> {
    return this.contacts.find({
      where: { student_id: studentId },
      order: { is_primary: 'DESC', id: 'ASC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(input: {
    student_id: number;
    relationship: GuardianRelationship;
    name: string;
    mobile_number: string;
    email: string | null;
    is_primary?: boolean;
  }): Promise<StudentGuardian> {
    const student = await this.students.findOne({
      where: { id: input.student_id },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const existing = await this.contacts.findOne({
      where: {
        student_id: input.student_id,
        relationship: input.relationship,
      },
    });
    if (existing) {
      throw new ConflictException(
        `This student already has a ${input.relationship} contact. Edit it instead.`,
      );
    }

    return this.contacts.save(
      this.contacts.create({
        student_id: input.student_id,
        relationship: input.relationship,
        name: input.name,
        mobile_number: input.mobile_number,
        email: input.email,
        is_primary: input.is_primary ?? false,
      }),
    );
  }

  async update(
    id: number,
    patch: {
      relationship?: GuardianRelationship;
      name?: string;
      mobile_number?: string;
      email?: string | null;
      is_primary?: boolean;
    },
  ): Promise<StudentGuardian> {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Guardian contact not found');

    if (
      patch.relationship !== undefined &&
      patch.relationship !== contact.relationship
    ) {
      const clash = await this.contacts.findOne({
        where: {
          student_id: contact.student_id,
          relationship: patch.relationship,
        },
      });
      if (clash) {
        throw new ConflictException(
          `This student already has a ${patch.relationship} contact.`,
        );
      }
      contact.relationship = patch.relationship;
    }
    if (patch.name !== undefined) contact.name = patch.name;
    if (patch.mobile_number !== undefined)
      contact.mobile_number = patch.mobile_number;
    if (patch.email !== undefined) contact.email = patch.email;
    if (patch.is_primary !== undefined) contact.is_primary = patch.is_primary;

    return this.contacts.save(contact);
  }

  async remove(id: number): Promise<void> {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Guardian contact not found');
    const mobile = contact.mobile_number;
    await this.contacts.remove(contact);
    // If that mobile is no longer a contact anywhere, revoke its sessions so it
    // can't keep viewing students it's no longer attached to.
    const stillUsed = await this.contacts.count({
      where: { mobile_number: mobile },
    });
    if (stillUsed === 0) {
      await this.guardianAuth.revokeAllForMobile(mobile, 'access_removed');
    }
  }

  async setLoginPassword(mobile: string, password: string): Promise<void> {
    await this.guardianAuth.adminSetPassword(mobile, password);
  }

  async sendOtp(mobile: string): Promise<void> {
    await this.guardianAuth.adminTriggerOtp(mobile);
  }

  /**
   * A parent login's signed-in devices, IP included (admin view). Keyed by
   * mobile — the login identity; a number that never set a password has no
   * sessions.
   */
  async listSessions(mobile: string): Promise<SessionRow[]> {
    const credId = await this.guardianAuth.credentialIdFor(mobile);
    if (credId === null) return [];
    return this.sessions.list('guardian', credId, { includeIp: true });
  }

  /** Force-sign-out one of a parent login's devices. */
  async revokeSession(mobile: string, sessionId: string): Promise<void> {
    const credId = await this.guardianAuth.credentialIdFor(mobile);
    const ok =
      credId !== null &&
      (await this.sessions.revokeById('guardian', credId, sessionId, 'admin'));
    if (!ok) throw new NotFoundException('Session not found');
  }

  // ---------------------------------------------------------------------------
  // Bulk upload — one row per student, NO cross-student dedup
  // ---------------------------------------------------------------------------

  /**
   * Each row carries a student roll plus up to three contacts (father/mother/
   * guardian). Contacts are stored per-student; there is no global guardian
   * identity and no reconciliation across students — the same mobile on two
   * students is simply two rows. Validation is within-row only; re-uploading a
   * student upserts its contacts by relationship. All-or-nothing on errors.
   */
  async bulkUpload(rows: BulkUploadGuardianRow[]): Promise<BulkUploadResult> {
    if (rows.length === 0) {
      return { contacts_upserted: 0, students_affected: 0, warnings: [] };
    }

    const errors: GuardianRowError[] = [];
    const warnings: GuardianRowError[] = [];
    const contactsByRow: Contact[][] = rows.map(() => []);

    rows.forEach((r, i) => {
      const defs: {
        role: BulkRole;
        name?: string;
        mobile?: string;
        email?: string;
      }[] = [
        {
          role: 'father',
          name: r.father_name,
          mobile: r.father_mobile,
          email: r.father_email,
        },
        {
          role: 'mother',
          name: r.mother_name,
          mobile: r.mother_mobile,
          email: r.mother_email,
        },
        {
          role: 'guardian',
          name: r.guardian_name,
          mobile: r.guardian_mobile,
          email: r.guardian_email,
        },
      ];

      const rowHadAttempt = defs.some((d) => d.name || d.mobile || d.email);
      if (!rowHadAttempt) {
        errors.push({
          rowIndex: i,
          field: 'student_id',
          message: 'At least one of father, mother or guardian is required',
        });
        return;
      }

      for (const d of defs) {
        if (!d.mobile) {
          if (d.name || d.email) {
            errors.push({
              rowIndex: i,
              field: `${d.role}_mobile`,
              message: `${d.role} mobile is required when ${d.role} details are given`,
            });
          }
          continue;
        }
        if (!MOBILE_RE.test(d.mobile)) {
          errors.push({
            rowIndex: i,
            field: `${d.role}_mobile`,
            message: 'Enter a 10-digit Indian mobile number',
          });
          continue;
        }
        if (!d.name) {
          errors.push({
            rowIndex: i,
            field: `${d.role}_name`,
            message: `${d.role} name is required`,
          });
          continue;
        }
        let email: string | null = null;
        if (d.email) {
          if (!emailParser.safeParse(d.email).success) {
            errors.push({
              rowIndex: i,
              field: `${d.role}_email`,
              message: 'Enter a valid email',
            });
            continue;
          }
          email = d.email.toLowerCase();
        }
        contactsByRow[i].push({
          rowIndex: i,
          role: d.role,
          name: d.name,
          mobile: d.mobile,
          email,
        });
      }

      // Within-student check: the same mobile used for two slots on one student.
      const mobiles = contactsByRow[i].map((c) => c.mobile);
      mobiles.forEach((m, idx) => {
        if (mobiles.indexOf(m) !== idx) {
          warnings.push({
            rowIndex: i,
            message: `Mobile ${m} is used for more than one contact on this student.`,
          });
        }
      });
    });

    // Resolve students by roll.
    const rolls = [...new Set(rows.map((r) => r.student_id))];
    const studentRows = rolls.length
      ? await this.students
          .createQueryBuilder('s')
          .where('s.student_id IN (:...rolls)', { rolls })
          .getMany()
      : [];
    const studentByRoll = new Map(
      studentRows.map((s) => [s.student_id.toUpperCase(), s]),
    );
    rows.forEach((r, i) => {
      if (!studentByRoll.has(r.student_id)) {
        errors.push({
          rowIndex: i,
          field: 'student_id',
          message: `student_id "${r.student_id}" not found`,
        });
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Bulk validation failed',
        rowErrors: errors,
      });
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(StudentGuardian);
      let upserted = 0;
      const affected = new Set<number>();

      for (let i = 0; i < rows.length; i++) {
        const student = studentByRoll.get(rows[i].student_id)!;
        for (const c of contactsByRow[i]) {
          affected.add(student.id);
          const existing = await repo.findOne({
            where: { student_id: student.id, relationship: c.role },
          });
          if (existing) {
            existing.name = c.name;
            existing.mobile_number = c.mobile;
            existing.email = c.email;
            await repo.save(existing);
          } else {
            await repo.save(
              repo.create({
                student_id: student.id,
                relationship: c.role,
                name: c.name,
                mobile_number: c.mobile,
                email: c.email,
                is_primary: false,
              }),
            );
          }
          upserted++;
        }
      }

      return { contacts_upserted: upserted, students_affected: affected.size };
    });

    return { ...result, warnings };
  }
}
