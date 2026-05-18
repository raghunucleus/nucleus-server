import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ProgrammeRegulationsSortField } from '../dto/list-programme-regulations.dto';
import { AdmissionYear } from '../entities/admission-year.entity';
import { Programme } from '../entities/programme.entity';
import { ProgrammeRegulation } from '../entities/programme-regulation.entity';
import { Regulation } from '../entities/regulation.entity';

export interface ListProgrammeRegulationsResult {
  rows: ProgrammeRegulation[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<ProgrammeRegulationsSortField, string> = {
  programme: 'programme.name',
  admission_year: 'admission_year.year',
  regulation: 'regulation.code',
  status: 'pr.is_active',
  created_at: 'pr.created_at',
  updated_at: 'pr.updated_at',
};

interface CreateProgrammeRegulationInput {
  programme_id: number;
  admission_year_id: number;
  regulation_id: number;
}

interface UpdateProgrammeRegulationInput {
  regulation_id: number;
}

@Injectable()
export class ProgrammeRegulationsService {
  constructor(
    @InjectRepository(ProgrammeRegulation)
    private readonly links: Repository<ProgrammeRegulation>,
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
    sortBy: ProgrammeRegulationsSortField;
    sortOrder: 'asc' | 'desc';
    status?: 'active' | 'inactive';
    programmeId?: number;
    admissionYearId?: number;
    regulationId?: number;
  }): Promise<ListProgrammeRegulationsResult> {
    const qb = this.links
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.programme', 'programme')
      .leftJoinAndSelect('pr.admission_year', 'admission_year')
      .leftJoinAndSelect('pr.regulation', 'regulation');

    if (opts.status === 'active') qb.andWhere('pr.is_active = TRUE');
    else if (opts.status === 'inactive') qb.andWhere('pr.is_active = FALSE');

    if (opts.programmeId !== undefined)
      qb.andWhere('pr.programme_id = :pid', { pid: opts.programmeId });
    if (opts.admissionYearId !== undefined)
      qb.andWhere('pr.admission_year_id = :ayid', { ayid: opts.admissionYearId });
    if (opts.regulationId !== undefined)
      qb.andWhere('pr.regulation_id = :rid', { rid: opts.regulationId });

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('pr.id', 'ASC')
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

  async getOne(id: number): Promise<ProgrammeRegulation> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme regulation not found');
    return row;
  }

  async create(
    input: CreateProgrammeRegulationInput,
  ): Promise<ProgrammeRegulation> {
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
    patch: UpdateProgrammeRegulationInput,
  ): Promise<ProgrammeRegulation> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme regulation not found');

    if (patch.regulation_id !== row.regulation_id) {
      await this.assertRegulationExists(patch.regulation_id);
      row.regulation_id = patch.regulation_id;
    }

    await this.links.save(row);
    return this.getOne(id);
  }

  async setActive(id: number, active: boolean): Promise<ProgrammeRegulation> {
    const row = await this.links.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme regulation not found');
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
        'This programme already has a regulation assigned for that admission year — edit the existing entry instead.',
      );
    }
  }
}
