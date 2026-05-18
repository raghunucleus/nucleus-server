import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ProgrammeSemestersSortField } from '../dto/list-programme-semesters.dto';
import { AdmissionYear } from '../entities/admission-year.entity';
import { Programme } from '../entities/programme.entity';
import {
  ProgrammeSemester,
  ProgrammeSemesterStatus,
} from '../entities/programme-semester.entity';
import { Semester } from '../entities/semester.entity';

export interface ListProgrammeSemestersResult {
  rows: ProgrammeSemester[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface BulkCreateProgrammeSemestersResult {
  created: ProgrammeSemester[];
  skipped: Array<{
    programme_id: number;
    admission_year_id: number;
    semester_id: number;
    reason: 'already_exists';
  }>;
}

// Sort by the joined parent rows' "natural" labels so the table reads
// alphabetically/numerically rather than by FK id.
const SORT_COLUMN: Record<ProgrammeSemestersSortField, string> = {
  programme: 'programme.name',
  admission_year: 'admission_year.year',
  semester: 'semester.sem_number',
  status: 'ps.is_active',
  created_at: 'ps.created_at',
  updated_at: 'ps.updated_at',
};

@Injectable()
export class ProgrammeSemestersService {
  constructor(
    @InjectRepository(ProgrammeSemester)
    private readonly links: Repository<ProgrammeSemester>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
    @InjectRepository(Semester)
    private readonly semesters: Repository<Semester>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: ProgrammeSemestersSortField;
    sortOrder: 'asc' | 'desc';
    status?: 'active' | 'inactive';
    programmeId?: number;
    admissionYearId?: number;
    semesterId?: number;
  }): Promise<ListProgrammeSemestersResult> {
    const qb = this.links
      .createQueryBuilder('ps')
      .leftJoinAndSelect('ps.programme', 'programme')
      .leftJoinAndSelect('ps.admission_year', 'admission_year')
      .leftJoinAndSelect('ps.semester', 'semester');

    if (opts.status === 'active') qb.andWhere('ps.is_active = TRUE');
    else if (opts.status === 'inactive') qb.andWhere('ps.is_active = FALSE');

    if (opts.programmeId !== undefined)
      qb.andWhere('ps.programme_id = :pid', { pid: opts.programmeId });
    if (opts.admissionYearId !== undefined)
      qb.andWhere('ps.admission_year_id = :ayid', { ayid: opts.admissionYearId });
    if (opts.semesterId !== undefined)
      qb.andWhere('ps.semester_id = :sid', { sid: opts.semesterId });

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('ps.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getOne(id: number): Promise<ProgrammeSemester> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme semester not found');
    return row;
  }

  async bulkCreate(input: {
    programme_id: number;
    admission_year_id: number;
    semester_ids: number[];
  }): Promise<BulkCreateProgrammeSemestersResult> {
    await this.assertProgrammeExists(input.programme_id);
    await this.assertAdmissionYearExists(input.admission_year_id);

    // De-dup the request's own list to keep the response predictable.
    const requestedSemesterIds = Array.from(new Set(input.semester_ids));

    // Validate every semester exists up front so a bad id surfaces a clean
    // 400 rather than a silent partial success.
    const semestersFound = await this.semesters
      .createQueryBuilder('s')
      .where('s.id IN (:...ids)', { ids: requestedSemesterIds })
      .getMany();
    const foundIds = new Set(semestersFound.map((s) => s.id));
    const missing = requestedSemesterIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown semester id(s): ${missing.join(', ')}`,
      );
    }

    // Find which (programme, year, semester) combos already exist so we can
    // skip them silently instead of erroring on the unique constraint.
    const existing = await this.links
      .createQueryBuilder('ps')
      .where('ps.programme_id = :pid', { pid: input.programme_id })
      .andWhere('ps.admission_year_id = :ayid', {
        ayid: input.admission_year_id,
      })
      .andWhere('ps.semester_id IN (:...sids)', { sids: requestedSemesterIds })
      .getMany();
    const existingSemIds = new Set(existing.map((e) => e.semester_id));

    const toInsert = requestedSemesterIds.filter(
      (sid) => !existingSemIds.has(sid),
    );

    const created: ProgrammeSemester[] = [];
    if (toInsert.length > 0) {
      const entities = toInsert.map((sid) =>
        this.links.create({
          programme_id: input.programme_id,
          admission_year_id: input.admission_year_id,
          semester_id: sid,
          is_active: true,
        }),
      );
      const saved = await this.links.save(entities);
      // Re-read with relations so each row matches list()'s shape.
      const ids = saved.map((s) => s.id);
      const hydrated = await this.links
        .createQueryBuilder('ps')
        .leftJoinAndSelect('ps.programme', 'programme')
        .leftJoinAndSelect('ps.admission_year', 'admission_year')
        .leftJoinAndSelect('ps.semester', 'semester')
        .where('ps.id IN (:...ids)', { ids })
        .getMany();
      created.push(...hydrated);
    }

    return {
      created,
      skipped: Array.from(existingSemIds).map((sid) => ({
        programme_id: input.programme_id,
        admission_year_id: input.admission_year_id,
        semester_id: sid,
        reason: 'already_exists' as const,
      })),
    };
  }

  async setActive(id: number, active: boolean): Promise<ProgrammeSemester> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme semester not found');
    if (row.is_active === active) return row;
    row.is_active = active;
    await this.links.save(row);
    return this.getOne(id);
  }

  // Forward-only transitions: upcoming -> ongoing -> completed. Any other
  // jump (e.g. completed back to upcoming) is rejected so the admin cannot
  // accidentally reopen a finished batch's semester. Starting a semester
  // additionally requires every preceding active semester in the same batch
  // to already be 'completed' (semesters progress in sem_number order).
  async setStatus(
    id: number,
    target: ProgrammeSemesterStatus,
  ): Promise<ProgrammeSemester> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme semester not found');
    if (row.status === target) return this.getOne(id);

    const allowed: Record<ProgrammeSemesterStatus, ProgrammeSemesterStatus[]> = {
      upcoming: ['ongoing'],
      ongoing: ['completed'],
      completed: [],
    };
    if (!allowed[row.status].includes(target)) {
      throw new ConflictException(
        `Cannot move semester from '${row.status}' to '${target}'.`,
      );
    }

    if (target === 'ongoing') {
      // Sequential gate: every earlier active semester in the same batch
      // must already be completed. Inactive ones are skipped — the admin
      // explicitly deactivated those links and shouldn't have to "complete"
      // them just to unblock later semesters.
      const blocker = await this.links
        .createQueryBuilder('ps')
        .leftJoinAndSelect('ps.semester', 'semester')
        .where('ps.programme_id = :pid', { pid: row.programme_id })
        .andWhere('ps.admission_year_id = :ayid', { ayid: row.admission_year_id })
        .andWhere('ps.id != :id', { id: row.id })
        .andWhere('ps.is_active = TRUE')
        .andWhere('ps.status != :done', { done: 'completed' })
        .andWhere('semester.sem_number < :sn', { sn: row.semester.sem_number })
        .orderBy('semester.sem_number', 'ASC')
        .getOne();
      if (blocker) {
        throw new ConflictException(
          `Cannot start ${row.semester.code}: semester ${blocker.semester.sem_number} (${blocker.semester.code}) is still '${blocker.status}'.`,
        );
      }
    }

    row.status = target;
    await this.links.save(row);
    return this.getOne(id);
  }

  private async assertProgrammeExists(id: number): Promise<void> {
    const exists = await this.programmes.exists({ where: { id } });
    if (!exists) throw new BadRequestException('Selected programme does not exist');
  }

  private async assertAdmissionYearExists(id: number): Promise<void> {
    const exists = await this.admissionYears.exists({ where: { id } });
    if (!exists)
      throw new BadRequestException('Selected admission year does not exist');
  }
}
