import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import type { CreateAcademicHolidayDto } from '../dto/create-academic-holiday.dto';
import { AcademicHoliday } from '../entities/academic-holiday.entity';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { ClassSession } from '../entities/class-session.entity';
import { ClassSessionAuditLog } from '../entities/class-session-audit-log.entity';
import { Programme } from '../entities/programme.entity';

export interface DeclareResult {
  holiday: AcademicHoliday;
  sessions_cancelled: number;
}

interface DeclarerContext {
  admin_id?: number;
  employee_id?: number;
}

@Injectable()
export class HolidaysService {
  private readonly logger = new Logger(HolidaysService.name);

  constructor(
    @InjectRepository(AcademicHoliday)
    private readonly holidays: Repository<AcademicHoliday>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AttendanceGroup)
    private readonly attendanceGroups: Repository<AttendanceGroup>,
    private readonly dataSource: DataSource,
  ) {}

  async list(opts: {
    from?: string;
    to?: string;
    scope?: 'institution' | 'programme' | 'group';
    programme_id?: number;
    attendance_group_id?: number;
  }): Promise<AcademicHoliday[]> {
    const qb = this.holidays
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.programme', 'programme')
      .leftJoinAndSelect('h.attendance_group', 'attendance_group')
      .leftJoinAndSelect('h.declared_by_employee', 'declared_by_employee')
      .leftJoinAndSelect('h.declared_by_admin', 'declared_by_admin')
      .orderBy('h.date', 'ASC');

    if (opts.from) {
      qb.andWhere('COALESCE(h.end_date, h.date) >= :from', { from: opts.from });
    }
    if (opts.to) {
      qb.andWhere('h.date <= :to', { to: opts.to });
    }
    if (opts.scope) {
      qb.andWhere('h.scope = :s', { s: opts.scope });
    }
    if (opts.programme_id !== undefined) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('h.programme_id = :pid', { pid: opts.programme_id })
            .orWhere("h.scope = 'institution'"),
        ),
      );
    }
    if (opts.attendance_group_id !== undefined) {
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('h.attendance_group_id = :gid', {
              gid: opts.attendance_group_id,
            })
            .orWhere("h.scope = 'institution'")
            .orWhere(
              `(h.scope = 'programme' AND h.programme_id = (
                 SELECT programme_id FROM attendance_groups WHERE id = :gid
               ))`,
            ),
        ),
      );
    }
    return qb.getMany();
  }

  // Declare a holiday and (optionally) mass-cancel any scheduled sessions
  // that fall in its date range and scope. The cancellation step writes
  // class_session_audit_logs rows for every affected session so the
  // cascade is auditable.
  async declare(
    input: CreateAcademicHolidayDto,
    declarer: DeclarerContext,
  ): Promise<DeclareResult> {
    this.assertDeclarer(declarer);
    if (input.scope === 'programme' && input.programme_id) {
      const exists = await this.programmes.exists({
        where: { id: input.programme_id },
      });
      if (!exists) {
        throw new BadRequestException('Selected programme does not exist');
      }
    }
    if (input.scope === 'group' && input.attendance_group_id) {
      const exists = await this.attendanceGroups.exists({
        where: { id: input.attendance_group_id },
      });
      if (!exists) {
        throw new BadRequestException('Selected attendance group does not exist');
      }
    }

    return this.dataSource.transaction(async (tx) => {
      const holidayRepo = tx.getRepository(AcademicHoliday);
      const sessions = tx.getRepository(ClassSession);
      const audit = tx.getRepository(ClassSessionAuditLog);

      const saved = await holidayRepo.save(
        holidayRepo.create({
          date: input.date,
          end_date: input.end_date ?? null,
          name: input.name,
          scope: input.scope,
          programme_id:
            input.scope === 'institution' ? null : input.programme_id ?? null,
          attendance_group_id:
            input.scope === 'group' ? input.attendance_group_id ?? null : null,
          type: input.type,
          reason: input.reason ?? null,
          declared_by_admin_id: declarer.admin_id ?? null,
          declared_by_employee_id: declarer.employee_id ?? null,
        }),
      );

      let cancelled = 0;
      if (input.cancel_existing_sessions) {
        // Build the set of scheduled sessions caught by the new holiday so
        // each can be audited individually before the bulk update.
        const findQb = sessions
          .createQueryBuilder('cs')
          .where("cs.status = 'scheduled'")
          .andWhere('cs.session_date BETWEEN :from AND :to', {
            from: saved.date,
            to: saved.end_date ?? saved.date,
          });

        if (saved.scope === 'group') {
          findQb.andWhere('cs.attendance_group_id = :gid', {
            gid: saved.attendance_group_id,
          });
        } else if (saved.scope === 'programme') {
          findQb.andWhere(
            `cs.programme_semester_id IN (
               SELECT id FROM programme_semesters WHERE programme_id = :pid
             )`,
            { pid: saved.programme_id },
          );
        }
        // 'institution' — no scope filter; all matching dates everywhere.

        const affected = await findQb.getMany();
        if (affected.length > 0) {
          const reason = `Holiday: ${saved.name}`;
          await sessions
            .createQueryBuilder()
            .update()
            .set({ status: 'cancelled', cancel_reason: reason })
            .whereInIds(affected.map((s) => s.id))
            .execute();

          // One audit row per cancellation. The actor we record depends on
          // whichever id the declarer carries — for admin-declared holidays
          // there is no employee id, so audit uses a sentinel of 0 only if
          // both are absent (which the precondition refuses).
          if (declarer.employee_id !== undefined) {
            await audit.save(
              affected.map((s) =>
                audit.create({
                  class_session_id: s.id,
                  action: 'cancel',
                  before: {
                    status: s.status,
                    cancel_reason: s.cancel_reason,
                  },
                  after: {
                    status: 'cancelled',
                    cancel_reason: reason,
                  },
                  reason,
                  performed_by_employee_id: declarer.employee_id!,
                }),
              ),
            );
          }
          // Admin-declared cascades are captured by the holiday row itself
          // (it carries declared_by_admin_id). Session-level audit rows
          // for admin actions can be added in a follow-up once the audit
          // schema gains an admin actor.
          cancelled = affected.length;
        }
      }

      this.logger.log(
        `declare: holiday=${saved.id} scope=${saved.scope} range=${saved.date}..${saved.end_date ?? saved.date} sessions_cancelled=${cancelled}`,
      );
      return { holiday: saved, sessions_cancelled: cancelled };
    });
  }

  async remove(id: number): Promise<void> {
    const row = await this.holidays.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Holiday not found');
    // Removing the row does NOT un-cancel any sessions it cancelled.
    // Re-opening a class is a separate, deliberate group-incharge action.
    await this.holidays.remove(row);
  }

  private assertDeclarer(d: DeclarerContext): void {
    const hasAdmin = d.admin_id !== undefined && d.admin_id !== null;
    const hasEmployee = d.employee_id !== undefined && d.employee_id !== null;
    if (hasAdmin === hasEmployee) {
      throw new BadRequestException(
        'A holiday must be declared by exactly one of admin or employee.',
      );
    }
  }
}
