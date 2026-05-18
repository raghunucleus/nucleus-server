import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const ACADEMIC_LEVELS = ['UG', 'PG'] as const;
export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];

@Entity({ name: 'degrees' })
@Unique('UQ_degrees_name', ['name'])
@Unique('UQ_degrees_code', ['code'])
@Unique('UQ_degrees_short_name', ['short_name'])
export class Degree {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  short_name: string;

  // Free-form string so new academic levels can be added without a DB migration.
  // Validation is enforced at the DTO layer.
  @Column({ type: 'varchar', length: 16 })
  academic_level: string;

  // 1–8 inclusive; range enforced at the DTO layer.
  @Column({ type: 'int' })
  duration_years: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
