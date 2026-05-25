import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SubjectsSortField } from '../dto/list-subjects.dto';
import { Regulation } from '../entities/regulation.entity';
import { Subject } from '../entities/subject.entity';
import { SubjectType } from '../entities/subject-type.entity';

export interface ListSubjectsResult {
  rows: Subject[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<SubjectsSortField, string> = {
  code: 's.code',
  name: 's.name',
  status: 's.is_active',
  created_at: 's.created_at',
  updated_at: 's.updated_at',
};

interface CreateSubjectInput {
  regulation_id: number;
  subject_type_id: number;
  code: string;
  name: string;
}

interface UpdateSubjectInput {
  subject_type_id?: number;
  code?: string;
  name?: string;
}

@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private readonly subjects: Repository<Subject>,
    @InjectRepository(Regulation)
    private readonly regulations: Repository<Regulation>,
    @InjectRepository(SubjectType)
    private readonly subjectTypes: Repository<SubjectType>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: SubjectsSortField;
    sortOrder: 'asc' | 'desc';
    codeSearch?: string;
    nameSearch?: string;
    status?: 'active' | 'inactive';
    regulationId?: number;
    subjectTypeId?: number;
  }): Promise<ListSubjectsResult> {
    const qb = this.subjects
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.regulation', 'regulation')
      .leftJoinAndSelect('s.subject_type', 'subject_type');

    if (opts.codeSearch) {
      qb.andWhere('LOWER(s.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.nameSearch) {
      qb.andWhere('LOWER(s.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('s.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('s.is_active = FALSE');
    }

    if (opts.regulationId !== undefined) {
      qb.andWhere('s.regulation_id = :rid', { rid: opts.regulationId });
    }

    if (opts.subjectTypeId !== undefined) {
      qb.andWhere('s.subject_type_id = :stid', { stid: opts.subjectTypeId });
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('s.id', 'ASC')
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

  async getOne(id: number): Promise<Subject> {
    const row = await this.subjects.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject not found');
    return row;
  }

  async create(input: CreateSubjectInput): Promise<Subject> {
    await this.assertRegulationExists(input.regulation_id);
    await this.assertSubjectTypeExists(input.subject_type_id);
    await this.assertCodeUnique(input.code);
    await this.assertNameUniqueInRegulation(input.regulation_id, input.name);

    const row = this.subjects.create({
      regulation_id: input.regulation_id,
      subject_type_id: input.subject_type_id,
      code: input.code,
      name: input.name,
      is_active: true,
    });
    const saved = await this.subjects.save(row);
    return this.getOne(saved.id);
  }

  async update(id: number, patch: UpdateSubjectInput): Promise<Subject> {
    const row = await this.subjects.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject not found');

    if (
      patch.subject_type_id !== undefined &&
      patch.subject_type_id !== row.subject_type_id
    ) {
      await this.assertSubjectTypeExists(patch.subject_type_id);
      row.subject_type_id = patch.subject_type_id;
      // subject_type is eager-loaded — without overwriting the relation
      // object too, save() can reconcile the FK back to the OLD type's id.
      row.subject_type = { id: patch.subject_type_id } as SubjectType;
    }
    if (patch.code !== undefined && patch.code !== row.code) {
      await this.assertCodeUnique(patch.code, id);
      row.code = patch.code;
    }
    if (patch.name !== undefined && patch.name !== row.name) {
      await this.assertNameUniqueInRegulation(row.regulation_id, patch.name, id);
      row.name = patch.name;
    }

    await this.subjects.save(row);
    return this.getOne(id);
  }

  async setActive(id: number, active: boolean): Promise<Subject> {
    const row = await this.subjects.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject not found');
    if (row.is_active === active) return row;
    row.is_active = active;
    await this.subjects.save(row);
    return this.getOne(id);
  }

  private async assertRegulationExists(id: number): Promise<void> {
    const exists = await this.regulations.exists({ where: { id } });
    if (!exists) throw new BadRequestException('Selected regulation does not exist');
  }

  private async assertSubjectTypeExists(id: number): Promise<void> {
    const exists = await this.subjectTypes.exists({ where: { id } });
    if (!exists)
      throw new BadRequestException('Selected subject type does not exist');
  }

  private async assertCodeUnique(code: string, excludeId?: number): Promise<void> {
    const qb = this.subjects
      .createQueryBuilder('s')
      .where('LOWER(s.code) = LOWER(:v)', { v: code });
    if (excludeId !== undefined) qb.andWhere('s.id != :id', { id: excludeId });
    if (await qb.getOne())
      throw new ConflictException('Subject code is already in use');
  }

  private async assertNameUniqueInRegulation(
    regulationId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const qb = this.subjects
      .createQueryBuilder('s')
      .where('s.regulation_id = :rid', { rid: regulationId })
      .andWhere('LOWER(s.name) = LOWER(:v)', { v: name });
    if (excludeId !== undefined) qb.andWhere('s.id != :id', { id: excludeId });
    if (await qb.getOne())
      throw new ConflictException(
        'Subject name is already in use under this regulation',
      );
  }
}
