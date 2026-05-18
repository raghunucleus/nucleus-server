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

@Entity({ name: 'subjects' })
// Subject code is globally unique across all regulations. Names are unique
// only within a regulation (same name can exist under AR23 and AR20).
@Unique('UQ_subjects_code', ['code'])
@Unique('UQ_subjects_regulation_name', ['regulation_id', 'name'])
export class Subject {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  regulation_id: number;

  @ManyToOne(() => Regulation, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'regulation_id' })
  regulation: Regulation;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
