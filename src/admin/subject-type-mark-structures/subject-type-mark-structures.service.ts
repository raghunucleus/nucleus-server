import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Regulation } from '../entities/regulation.entity';
import {
  MarkStructureL1Component,
  SubjectTypeMarkStructure,
} from '../entities/subject-type-mark-structure.entity';
import { SubjectType } from '../entities/subject-type.entity';

export interface MarkStructureBySubjectType {
  subject_type: SubjectType;
  structure: SubjectTypeMarkStructure | null;
}

interface SaveMarkStructureInput {
  max_marks: number;
  components: MarkStructureL1Component[];
}

@Injectable()
export class SubjectTypeMarkStructuresService {
  constructor(
    @InjectRepository(SubjectTypeMarkStructure)
    private readonly structures: Repository<SubjectTypeMarkStructure>,
    @InjectRepository(Regulation)
    private readonly regulations: Repository<Regulation>,
    @InjectRepository(SubjectType)
    private readonly subjectTypes: Repository<SubjectType>,
  ) {}

  // Hub view: every subject type alongside its structure for this regulation
  // (null when unconfigured).
  async listForRegulation(
    regulationId: number,
  ): Promise<MarkStructureBySubjectType[]> {
    await this.assertRegulation(regulationId);

    const [types, rows] = await Promise.all([
      this.subjectTypes.find({ order: { name: 'ASC' } }),
      this.structures.find({ where: { regulation_id: regulationId } }),
    ]);

    const byTypeId = new Map<number, SubjectTypeMarkStructure>();
    for (const r of rows) byTypeId.set(r.subject_type_id, r);

    return types.map((t) => ({
      subject_type: t,
      structure: byTypeId.get(t.id) ?? null,
    }));
  }

  async getOne(
    regulationId: number,
    subjectTypeId: number,
  ): Promise<SubjectTypeMarkStructure> {
    const row = await this.structures.findOne({
      where: { regulation_id: regulationId, subject_type_id: subjectTypeId },
    });
    if (!row) throw new NotFoundException('Mark structure not configured');
    return row;
  }

  // Upsert — replace the entire structure in one shot. Front-end always sends
  // the full tree, so partial PATCH isn't useful here.
  async save(
    regulationId: number,
    subjectTypeId: number,
    input: SaveMarkStructureInput,
  ): Promise<SubjectTypeMarkStructure> {
    await Promise.all([
      this.assertRegulation(regulationId),
      this.assertSubjectType(subjectTypeId),
    ]);

    const existing = await this.structures.findOne({
      where: { regulation_id: regulationId, subject_type_id: subjectTypeId },
    });

    if (existing) {
      existing.max_marks = input.max_marks;
      existing.components = input.components;
      return this.structures.save(existing);
    }

    const row = this.structures.create({
      regulation_id: regulationId,
      subject_type_id: subjectTypeId,
      max_marks: input.max_marks,
      components: input.components,
    });
    return this.structures.save(row);
  }

  async remove(regulationId: number, subjectTypeId: number): Promise<void> {
    const result = await this.structures.delete({
      regulation_id: regulationId,
      subject_type_id: subjectTypeId,
    });
    if (!result.affected)
      throw new NotFoundException('Mark structure not configured');
  }

  private async assertRegulation(id: number): Promise<void> {
    const exists = await this.regulations.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Regulation not found');
  }

  private async assertSubjectType(id: number): Promise<void> {
    const exists = await this.subjectTypes.exists({ where: { id } });
    if (!exists) throw new NotFoundException('Subject type not found');
  }
}
