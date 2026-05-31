import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ProgrammeAdmissionYearsSortField } from '../dto/list-programme-admission-years.dto';
import { AdmissionYear } from '../entities/admission-year.entity';
import { Programme } from '../entities/programme.entity';
import { ProgrammeAdmissionYear } from '../entities/programme-admission-year.entity';
import { Regulation } from '../entities/regulation.entity';

export interface ListProgrammeAdmissionYearsResult {
  rows: ProgrammeAdmissionYear[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<ProgrammeAdmissionYearsSortField, string> = {
  programme: 'programme.name',
  admission_year: 'admission_year.year',
  regulation: 'regulation.code',
  status: 'pay.is_active',
  created_at: 'pay.created_at',
  updated_at: 'pay.updated_at',
};

interface CreateProgrammeAdmissionYearInput {
  programme_id: number;
  admission_year_id: number;
  regulation_id: number;
}

interface UpdateProgrammeAdmissionYearInput {
  regulation_id: number;
}

@Injectable()
export class ProgrammeAdmissionYearsService {
  constructor(
    @InjectRepository(ProgrammeAdmissionYear)
    private readonly links: Repository<ProgrammeAdmissionYear>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
    @InjectRepository(Regulation)
    private readonly regulations: Repository<Regulation>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: ProgrammeAdmissionYearsSortField;
    sortOrder: 'asc' | 'desc';
    status?: 'active' | 'inactive';
    programmeId?: number;
    admissionYearId?: number;
    regulationId?: number;
  }): Promise<ListProgrammeAdmissionYearsResult> {
    const qb = this.links
      .createQueryBuilder('pay')
      .leftJoinAndSelect('pay.programme', 'programme')
      .leftJoinAndSelect('pay.admission_year', 'admission_year')
      .leftJoinAndSelect('pay.regulation', 'regulation');

    if (opts.status === 'active') qb.andWhere('pay.is_active = TRUE');
    else if (opts.status === 'inactive') qb.andWhere('pay.is_active = FALSE');

    if (opts.programmeId !== undefined)
      qb.andWhere('pay.programme_id = :pid', { pid: opts.programmeId });
    if (opts.admissionYearId !== undefined)
      qb.andWhere('pay.admission_year_id = :ayid', { ayid: opts.admissionYearId });
    if (opts.regulationId !== undefined)
      qb.andWhere('pay.regulation_id = :rid', { rid: opts.regulationId });

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('pay.id', 'ASC')
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

  /**
   * Slim listing for the bulk-upload matrix. Returns every (programme,
   * admission year) pair as a flat array — no pagination, no joined entities —
   * so the UI can render the full programme × year grid in one request.
   */
  async matrix(): Promise<
    Array<{
      id: number;
      programme_id: number;
      programme_name: string;
      programme_code: string;
      admission_year_id: number;
      admission_year_display: string;
      admission_year_value: number;
      is_active: boolean;
    }>
  > {
    // Join programme + admission_year so a single unpaginated request carries
    // the labels the grid needs (rows × columns) — no follow-up lookups.
    const rows = await this.links
      .createQueryBuilder('pay')
      .leftJoin('pay.programme', 'p')
      .leftJoin('pay.admission_year', 'ay')
      .select([
        'pay.id',
        'pay.programme_id',
        'pay.admission_year_id',
        'pay.is_active',
      ])
      .addSelect(['p.name', 'p.code', 'ay.display_year', 'ay.year'])
      .orderBy('p.name', 'ASC')
      .addOrderBy('ay.year', 'DESC')
      .getMany();
    return rows.map((r) => ({
      id: r.id,
      programme_id: r.programme_id,
      programme_name: r.programme?.name ?? '—',
      programme_code: r.programme?.code ?? '',
      admission_year_id: r.admission_year_id,
      admission_year_display: r.admission_year?.display_year ?? '—',
      admission_year_value: r.admission_year?.year ?? 0,
      is_active: r.is_active,
    }));
  }

  async getOne(id: number): Promise<ProgrammeAdmissionYear> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme admission year not found');
    return row;
  }

  async create(
    input: CreateProgrammeAdmissionYearInput,
  ): Promise<ProgrammeAdmissionYear> {
    await this.assertReferencesExist(
      input.programme_id,
      input.admission_year_id,
      input.regulation_id,
    );
    await this.assertNoExistingMapping(
      input.programme_id,
      input.admission_year_id,
    );

    const row = this.links.create({
      programme_id: input.programme_id,
      admission_year_id: input.admission_year_id,
      regulation_id: input.regulation_id,
      is_active: true,
    });
    const saved = await this.links.save(row);
    return this.getOne(saved.id);
  }

  async update(
    id: number,
    patch: UpdateProgrammeAdmissionYearInput,
  ): Promise<ProgrammeAdmissionYear> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme admission year not found');

    if (patch.regulation_id !== row.regulation_id) {
      await this.assertRegulationExists(patch.regulation_id);
      // Use a partial UPDATE rather than mutate + save. Because the entity has
      // an eager `regulation` relation, save() would overwrite our column
      // change with the (stale) loaded relation's id and silently revert.
      await this.links.update({ id }, { regulation_id: patch.regulation_id });
    }

    return this.getOne(id);
  }

  async setActive(id: number, active: boolean): Promise<ProgrammeAdmissionYear> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme admission year not found');
    if (row.is_active === active) return row;
    row.is_active = active;
    await this.links.save(row);
    return this.getOne(id);
  }

  private async assertReferencesExist(
    programmeId: number,
    admissionYearId: number,
    regulationId: number,
  ): Promise<void> {
    if (!(await this.programmes.exists({ where: { id: programmeId } })))
      throw new BadRequestException('Selected programme does not exist');
    if (!(await this.admissionYears.exists({ where: { id: admissionYearId } })))
      throw new BadRequestException('Selected admission year does not exist');
    await this.assertRegulationExists(regulationId);
  }

  private async assertRegulationExists(regulationId: number): Promise<void> {
    if (!(await this.regulations.exists({ where: { id: regulationId } })))
      throw new BadRequestException('Selected regulation does not exist');
  }

  private async assertNoExistingMapping(
    programmeId: number,
    admissionYearId: number,
  ): Promise<void> {
    const existing = await this.links.findOne({
      where: {
        programme_id: programmeId,
        admission_year_id: admissionYearId,
      },
    });
    if (existing) {
      throw new ConflictException(
        'This programme already has an entry for that admission year — edit the existing entry instead.',
      );
    }
  }
}
