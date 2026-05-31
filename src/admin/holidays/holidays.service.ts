import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { CreateAcademicHolidayDto } from '../dto/create-academic-holiday.dto';
import type { UpdateAcademicHolidayDto } from '../dto/update-academic-holiday.dto';
import { AcademicHoliday } from '../entities/academic-holiday.entity';
import { ClassSession } from '../entities/class-session.entity';
import { ClassSessionAuditLog } from '../entities/class-session-audit-log.entity';

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
    private readonly dataSource: DataSource,
  ) {}

  async list(opts: { from?: string; to?: string }): Promise<AcademicHoliday[]> {
    const qb = this.holidays
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.declared_by_employee', 'declared_by_employee')
      .leftJoinAndSelect('h.declared_by_admin', 'declared_by_admin')
      .orderBy('h.date', 'ASC');

    if (opts.from) {
      qb.andWhere('COALESCE(h.end_date, h.date) >= :from', { from: opts.from });
    }
    if (opts.to) {
      qb.andWhere('h.date <= :to', { to: opts.to });
    }
    return qb.getMany();
  }

  // Declare an institution-wide holiday and (optionally) mass-cancel any
  // scheduled sessions that fall in its date range. The cancellation step
  // writes class_session_audit_logs rows for every affected session so the
  // cascade is auditable.
  async declare(
    input: CreateAcademicHolidayDto,
    declarer: DeclarerContext,
  ): Promise<DeclareResult> {
    this.assertDeclarer(declarer);

    return this.dataSource.transaction(async (tx) => {
      const holidayRepo = tx.getRepository(AcademicHoliday);

      const saved = await holidayRepo.save(
        holidayRepo.create({
          date: input.date,
          end_date: input.end_date ?? null,
          name: input.name,
          type: input.type,
          reason: input.reason ?? null,
          declared_by_admin_id: declarer.admin_id ?? null,
          declared_by_employee_id: declarer.employee_id ?? null,
        }),
      );

      const cancelled = input.cancel_existing_sessions
        ? await this.cancelMatchingSessions(tx, saved, declarer)
        : 0;

      this.logger.log(
        `declare: holiday=${saved.id} range=${saved.date}..${saved.end_date ?? saved.date} sessions_cancelled=${cancelled}`,
      );
      return { holiday: saved, sessions_cancelled: cancelled };
    });
  }

  // Edit an existing holiday. All editable fields are replaced from `input`
  // (the admin form pre-fills them). The original declarer is preserved.
  // If `input.cancel_existing_sessions` is true, scheduled sessions caught by
  // the *new* range are cancelled in the same transaction — sessions cancelled
  // by the previous version are never un-cancelled.
  async update(
    id: number,
    input: UpdateAcademicHolidayDto,
    declarer: DeclarerContext,
  ): Promise<DeclareResult> {
    this.assertDeclarer(declarer);

    return this.dataSource.transaction(async (tx) => {
      const holidayRepo = tx.getRepository(AcademicHoliday);
      const existing = await holidayRepo.findOne({ where: { id } });
      if (!existing) throw new NotFoundException('Holiday not found');

      existing.date = input.date;
      existing.end_date = input.end_date ?? null;
      existing.name = input.name;
      existing.type = input.type;
      existing.reason = input.reason ?? null;

      const saved = await holidayRepo.save(existing);

      const cancelled = input.cancel_existing_sessions
        ? await this.cancelMatchingSessions(tx, saved, declarer)
        : 0;

      this.logger.log(
        `update: holiday=${saved.id} range=${saved.date}..${saved.end_date ?? saved.date} sessions_cancelled=${cancelled}`,
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

  // Mass-cancel every still-scheduled session in `holiday`'s date range —
  // holidays are institution-wide, so there is no scope narrowing. Writes one
  // class_session_audit_log row per cancellation (employee actor only — see
  // note below). Returns the number of sessions cancelled.
  private async cancelMatchingSessions(
    tx: EntityManager,
    holiday: AcademicHoliday,
    declarer: DeclarerContext,
  ): Promise<number> {
    const sessions = tx.getRepository(ClassSession);
    const audit = tx.getRepository(ClassSessionAuditLog);

    // Build the set of scheduled sessions caught by the holiday so each can
    // be audited individually before the bulk update.
    const affected = await sessions
      .createQueryBuilder('cs')
      .where("cs.status = 'scheduled'")
      .andWhere('cs.session_date BETWEEN :from AND :to', {
        from: holiday.date,
        to: holiday.end_date ?? holiday.date,
      })
      .getMany();
    if (affected.length === 0) return 0;

    const reason = `Holiday: ${holiday.name}`;
    await sessions
      .createQueryBuilder()
      .update()
      .set({ status: 'cancelled', cancel_reason: reason })
      .whereInIds(affected.map((s) => s.id))
      .execute();

    // One audit row per cancellation. The actor we record depends on whichever
    // id the declarer carries — admin-declared cascades are captured by the
    // holiday row itself (declared_by_admin_id); session-level audit rows for
    // admin actions can be added once the audit schema gains an admin actor.
    if (declarer.employee_id !== undefined) {
      await audit.save(
        affected.map((s) =>
          audit.create({
            class_session_id: s.id,
            action: 'cancel',
            before: { status: s.status, cancel_reason: s.cancel_reason },
            after: { status: 'cancelled', cancel_reason: reason },
            reason,
            performed_by_employee_id: declarer.employee_id!,
          }),
        ),
      );
    }
    return affected.length;
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
