import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { BulkCreateSubjectRow } from '../dto/bulk-create-subjects.dto';
import {
  SUBJECT_CODE_MESSAGE,
  SUBJECT_CODE_REGEX,
} from '../dto/create-subject.dto';
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

export interface SubjectRowError {
  rowIndex: number;
  field?: 'subject_type' | 'code' | 'name';
  message: string;
}

export interface BulkCreateSubjectsResult {
  created: number;
}

const SUBJECT_CODE_MAX = 32;

@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private readonly subjects: Repository<Subject>,
    @InjectRepository(Regulation)
    private readonly regulations: Repository<Regulation>,
    @InjectRepository(SubjectType)
    private readonly subjectTypes: Repository<SubjectType>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

  /**
   * Create-only bulk insert under one regulation. The subject type cell may
   * hold a type's code or its name (case-insensitive). Every problem — missing
   * cells, bad code format, unknown/inactive type, duplicates within the file
   * or against existing subjects — is collected as a per-cell row error; any
   * error rejects the whole batch.
   */
  async bulkCreate(
    regulationId: number,
    rows: BulkCreateSubjectRow[],
  ): Promise<BulkCreateSubjectsResult> {
    await this.assertRegulationExists(regulationId);

    const types = await this.subjectTypes.find();
    const typeByCode = new Map(types.map((t) => [t.code.toUpperCase(), t]));
    const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));

    const errors: SubjectRowError[] = [];
    const resolved: ({
      subject_type_id: number;
      code: string;
      name: string;
    } | null)[] = [];
    const firstRowByCode = new Map<string, number>();
    const firstRowByName = new Map<string, number>();

    rows.forEach((r, i) => {
      let typeId: number | null = null;
      if (!r.subject_type) {
        errors.push({
          rowIndex: i,
          field: 'subject_type',
          message: 'Required',
        });
      } else {
        const t =
          typeByCode.get(r.subject_type.toUpperCase()) ??
          typeByName.get(r.subject_type.toLowerCase());
        if (!t) {
          errors.push({
            rowIndex: i,
            field: 'subject_type',
            message: `Unknown subject type "${r.subject_type}"`,
          });
        } else if (!t.is_active) {
          errors.push({
            rowIndex: i,
            field: 'subject_type',
            message: `Subject type "${t.code}" is inactive`,
          });
        } else {
          typeId = t.id;
        }
      }

      let code: string | null = null;
      if (!r.code) {
        errors.push({ rowIndex: i, field: 'code', message: 'Required' });
      } else {
        const upper = r.code.toUpperCase();
        if (upper.length > SUBJECT_CODE_MAX) {
          errors.push({
            rowIndex: i,
            field: 'code',
            message: `Max ${SUBJECT_CODE_MAX} characters`,
          });
        } else if (!SUBJECT_CODE_REGEX.test(upper)) {
          errors.push({
            rowIndex: i,
            field: 'code',
            message: SUBJECT_CODE_MESSAGE,
          });
        } else if (firstRowByCode.has(upper)) {
          errors.push({
            rowIndex: i,
            field: 'code',
            message: `Duplicate of row ${firstRowByCode.get(upper)! + 1}`,
          });
        } else {
          firstRowByCode.set(upper, i);
          code = upper;
        }
      }

      let name: string | null = null;
      if (!r.name) {
        errors.push({ rowIndex: i, field: 'name', message: 'Required' });
      } else {
        const key = r.name.toLowerCase();
        if (firstRowByName.has(key)) {
          errors.push({
            rowIndex: i,
            field: 'name',
            message: `Duplicate of row ${firstRowByName.get(key)! + 1}`,
          });
        } else {
          firstRowByName.set(key, i);
          name = r.name;
        }
      }

      resolved.push(
        typeId !== null && code !== null && name !== null
          ? { subject_type_id: typeId, code, name }
          : null,
      );
    });

    // Clashes with existing subjects. Codes are unique across all regulations;
    // names only within this one.
    if (firstRowByCode.size > 0) {
      const clashes = await this.subjects
        .createQueryBuilder('s')
        .leftJoinAndSelect('s.regulation', 'regulation')
        .where('UPPER(s.code) IN (:...codes)', {
          codes: [...firstRowByCode.keys()],
        })
        .getMany();
      for (const s of clashes) {
        const i = firstRowByCode.get(s.code.toUpperCase());
        if (i === undefined) continue;
        errors.push({
          rowIndex: i,
          field: 'code',
          message:
            s.regulation_id === regulationId
              ? 'Code already exists in this regulation'
              : `Code already exists (${s.regulation?.code ?? 'another regulation'})`,
        });
      }
    }
    if (firstRowByName.size > 0) {
      const clashes = await this.subjects
        .createQueryBuilder('s')
        .where('s.regulation_id = :rid', { rid: regulationId })
        .andWhere('LOWER(s.name) IN (:...names)', {
          names: [...firstRowByName.keys()],
        })
        .getMany();
      for (const s of clashes) {
        const i = firstRowByName.get(s.name.toLowerCase());
        if (i === undefined) continue;
        errors.push({
          rowIndex: i,
          field: 'name',
          message: 'Name already used in this regulation',
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Bulk validation failed',
        rowErrors: errors,
      });
    }

    const toInsert = resolved.map((r) => ({
      ...r!,
      regulation_id: regulationId,
      is_active: true,
    }));
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(Subject).insert(toInsert);
      });
    } catch (err) {
      // Only a concurrent create can slip past the checks above.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException(
          'A subject code or name was created concurrently — upload again to see which',
        );
      }
      throw err;
    }
    return { created: toInsert.length };
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
      await this.assertNameUniqueInRegulation(
        row.regulation_id,
        patch.name,
        id,
      );
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
    if (!exists)
      throw new BadRequestException('Selected regulation does not exist');
  }

  private async assertSubjectTypeExists(id: number): Promise<void> {
    const exists = await this.subjectTypes.exists({ where: { id } });
    if (!exists)
      throw new BadRequestException('Selected subject type does not exist');
  }

  private async assertCodeUnique(
    code: string,
    excludeId?: number,
  ): Promise<void> {
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
