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
import { Degree } from './degree.entity';
import { Department } from './department.entity';

@Entity({ name: 'programmes' })
@Unique('UQ_programmes_name', ['name'])
@Unique('UQ_programmes_code', ['code'])
export class Programme {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  display_name: string;

  @Column({ type: 'int' })
  degree_id: number;

  @ManyToOne(() => Degree, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'degree_id' })
  degree: Degree;

  @Column({ type: 'int' })
  department_id: number;

  @ManyToOne(() => Department, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
