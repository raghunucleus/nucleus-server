import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Regulation } from './regulation.entity';
import { SubjectType } from './subject-type.entity';

// Rule kinds applied at L2 to derive an item's mark from inputs.
// `direct` means the L2 item is itself the leaf (one mark, no inputs).
export const MARK_RULE_KINDS = [
  'direct',
  'sum',
  'best_k_of_n',
  'rank_weighted',
] as const;
export type MarkRuleKind = (typeof MARK_RULE_KINDS)[number];

export interface MarkRuleInput {
  code: string;
  name?: string;
  max_marks: number;
}

export type MarkRule =
  | { kind: 'direct' }
  | { kind: 'sum'; inputs: MarkRuleInput[] }
  | { kind: 'best_k_of_n'; k: number; inputs: MarkRuleInput[] }
  | { kind: 'rank_weighted'; weights: number[]; inputs: MarkRuleInput[] };

export interface MarkStructureL2Item {
  code: string;
  name?: string;
  max_marks: number;
  rule: MarkRule;
}

export interface MarkStructureL1Component {
  code: string;
  name?: string;
  max_marks: number;
  items: MarkStructureL2Item[];
}

@Entity({ name: 'subject_type_mark_structures' })
@Unique('UQ_stms_regulation_subject_type', ['regulation_id', 'subject_type_id'])
export class SubjectTypeMarkStructure {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  regulation_id: number;

  @ManyToOne(() => Regulation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'regulation_id' })
  regulation: Regulation;

  @Column({ type: 'int' })
  subject_type_id: number;

  @ManyToOne(() => SubjectType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_type_id' })
  subject_type: SubjectType;

  // Total marks at the structure root — must equal the sum of L1 component max_marks.
  @Column({ type: 'int' })
  max_marks: number;

  // The L1 component tree. JSONB validated at the DTO layer.
  @Column({ type: 'jsonb' })
  components: MarkStructureL1Component[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
