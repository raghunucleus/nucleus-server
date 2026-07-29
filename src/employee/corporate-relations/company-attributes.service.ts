import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LookupDto, UpdateLookupDto } from './dto/attribute.dto';
import {
  COMPANY_LOOKUP_KINDS,
  CompanyCategory,
  CompanyLookupBase,
  CompanyLookupKind,
} from './entities/company-lookups.entity';

/**
 * CRUD over the configurable company-classifier lookups — categories, the only
 * kind left. The `kind` URL segment is validated against an explicit whitelist
 * → repository map so the parameterised endpoint stays greppable (no dynamic
 * entity resolution), and so a second kind is one map entry away.
 */
@Injectable()
export class CompanyAttributesService {
  private readonly repos: Record<
    CompanyLookupKind,
    Repository<CompanyLookupBase>
  >;

  constructor(
    @InjectRepository(CompanyCategory)
    categories: Repository<CompanyCategory>,
  ) {
    this.repos = { categories };
  }

  private repo(kind: string): Repository<CompanyLookupBase> {
    if (!(COMPANY_LOOKUP_KINDS as readonly string[]).includes(kind)) {
      throw new NotFoundException(`Unknown attribute type "${kind}".`);
    }
    return this.repos[kind as CompanyLookupKind];
  }

  list(kind: string, includeInactive = false): Promise<CompanyLookupBase[]> {
    const repo = this.repo(kind);
    return repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  /** All active lookups, keyed by kind — feeds the company form's pickers. */
  async activeByKind(): Promise<
    Record<CompanyLookupKind, CompanyLookupBase[]>
  > {
    const out = {} as Record<CompanyLookupKind, CompanyLookupBase[]>;
    for (const kind of COMPANY_LOOKUP_KINDS) {
      out[kind] = await this.repos[kind].find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      });
    }
    return out;
  }

  async create(kind: string, dto: LookupDto): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const exists = await repo.findOne({ where: { name: dto.name } });
    if (exists) {
      throw new BadRequestException(`"${dto.name}" already exists.`);
    }
    const row = repo.create({
      name: dto.name,
      sort_order: dto.sort_order ?? 0,
    });
    return repo.save(row);
  }

  async update(
    kind: string,
    id: number,
    dto: UpdateLookupDto,
  ): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    if (dto.name !== undefined && dto.name !== row.name) {
      const clash = await repo.findOne({ where: { name: dto.name } });
      if (clash) throw new BadRequestException(`"${dto.name}" already exists.`);
      row.name = dto.name;
    }
    if (dto.sort_order !== undefined) row.sort_order = dto.sort_order;
    return repo.save(row);
  }

  async setStatus(
    kind: string,
    id: number,
    isActive: boolean,
  ): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    row.is_active = isActive;
    return repo.save(row);
  }
}
