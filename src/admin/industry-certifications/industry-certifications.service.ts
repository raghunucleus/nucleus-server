import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IndustryCertificationsSortField } from '../dto/list-industry-certifications.dto';
import { IndustryCertification } from '../entities/industry-certification.entity';

export interface ListIndustryCertificationsResult {
  rows: IndustryCertification[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<IndustryCertificationsSortField, string> = {
  name: 'name',
  code: 'code',
  issuing_body: 'issuing_body',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateIndustryCertificationInput {
  name: string;
  code: string;
  description?: string | null;
  issuing_body?: string | null;
  website?: string | null;
}

interface UpdateIndustryCertificationInput {
  name?: string;
  code?: string;
  description?: string | null;
  issuing_body?: string | null;
  website?: string | null;
}

@Injectable()
export class IndustryCertificationsService {
  constructor(
    @InjectRepository(IndustryCertification)
    private readonly certifications: Repository<IndustryCertification>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: IndustryCertificationsSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    issuingBodySearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListIndustryCertificationsResult> {
    const qb = this.certifications.createQueryBuilder('c');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(c.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(c.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.issuingBodySearch) {
      qb.andWhere('LOWER(c.issuing_body) LIKE :ib', {
        ib: `%${opts.issuingBodySearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('c.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('c.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`c.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('c.id', 'ASC')
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

  async getOne(id: number): Promise<IndustryCertification> {
    const row = await this.certifications.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Industry certification not found');
    return row;
  }

  async create(
    input: CreateIndustryCertificationInput,
  ): Promise<IndustryCertification> {
    await this.assertUnique({ name: input.name, code: input.code });

    const row = this.certifications.create({
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      issuing_body: input.issuing_body ?? null,
      website: input.website ?? null,
      is_active: true,
    });
    return this.certifications.save(row);
  }

  async update(
    id: number,
    patch: UpdateIndustryCertificationInput,
  ): Promise<IndustryCertification> {
    const row = await this.certifications.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Industry certification not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== row.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== row.code
          ? patch.code
          : undefined,
      excludeId: id,
    });

    // `!== undefined` (not `!= null`): an explicit null clears the column,
    // while an absent key leaves it untouched.
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.issuing_body !== undefined) row.issuing_body = patch.issuing_body;
    if (patch.website !== undefined) row.website = patch.website;

    return this.certifications.save(row);
  }

  async setActive(id: number, active: boolean): Promise<IndustryCertification> {
    const row = await this.certifications.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Industry certification not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.certifications.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.certifications
        .createQueryBuilder('c')
        .where('LOWER(c.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined)
        qb.andWhere('c.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Name is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.certifications
        .createQueryBuilder('c')
        .where('LOWER(c.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('c.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
