import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { CompanyInteraction } from './company-interaction.entity';
import { CompanyRelationshipMilestone } from './company-relationship-milestone.entity';

/**
 * A file attached to a company (e.g. a signed MOU or JD). Always belongs to a
 * company; optionally hangs off a specific interaction or milestone via the
 * nullable parent columns. Bytes live in the private storage bucket keyed by
 * `file_key`.
 */
@Entity({ name: 'company_attachments' })
@Index('IDX_company_attachments_company_id', ['company_id'])
@Index('IDX_company_attachments_interaction_id', ['interaction_id'])
@Index('IDX_company_attachments_milestone_id', ['milestone_id'])
export class CompanyAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'int', nullable: true })
  interaction_id: number | null;

  @ManyToOne(() => CompanyInteraction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'interaction_id' })
  interaction: CompanyInteraction | null;

  @Column({ type: 'int', nullable: true })
  milestone_id: number | null;

  @ManyToOne(() => CompanyRelationshipMilestone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'milestone_id' })
  milestone: CompanyRelationshipMilestone | null;

  @Column({ type: 'varchar', length: 512 })
  file_key: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  content_type: string | null;

  @Column({ type: 'int', nullable: true })
  uploaded_by: number | null;

  @CreateDateColumn()
  created_at: Date;
}
