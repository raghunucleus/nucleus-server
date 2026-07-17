import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RegulationsSortField } from '../dto/list-regulations.dto';
import { Regulation } from '../entities/regulation.entity';

export interface ListRegulationsResult {
  rows: Regulation[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<RegulationsSortField, string> = {
  name: 'name',
  code: 'code',
  year_of_regulation: 'year_of_regulation',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateRegulationInput {
  name: string;
  code: string;
  year_of_regulation: number;
  description?: string | null;
}

interface UpdateRegulationInput {
  name?: string;
  code?: string;
  year_of_regulation?: number;
  description?: string | null;
}

@Injectable()
export class RegulationsService {
  constructor(
    @InjectRepository(Regulation)
    private readonly regulations: Repository<Regulation>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: RegulationsSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListRegulationsResult> {
    const qb = this.regulations.createQueryBuilder('r');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(r.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(r.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('r.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('r.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`r.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('r.id', 'ASC')
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

  async getOne(id: number): Promise<Regulation> {
    const row = await this.regulations.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Regulation not found');
    return row;
  }

  async create(input: CreateRegulationInput): Promise<Regulation> {
    await this.assertUnique({ name: input.name, code: input.code });

    const row = this.regulations.create({
      name: input.name,
      code: input.code,
      year_of_regulation: input.year_of_regulation,
      description: input.description ?? null,
      is_active: true,
    });
    return this.regulations.save(row);
  }

  async update(id: number, patch: UpdateRegulationInput): Promise<Regulation> {
    const row = await this.regulations.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Regulation not found');

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

    if (patch.name !== undefined) row.name = patch.name;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.year_of_regulation !== undefined)
      row.year_of_regulation = patch.year_of_regulation;
    if (patch.description !== undefined) row.description = patch.description;

    return this.regulations.save(row);
  }

  async setActive(id: number, active: boolean): Promise<Regulation> {
    const row = await this.regulations.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Regulation not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.regulations.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.regulations
        .createQueryBuilder('r')
        .where('LOWER(r.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined)
        qb.andWhere('r.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Name is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.regulations
        .createQueryBuilder('r')
        .where('LOWER(r.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('r.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
