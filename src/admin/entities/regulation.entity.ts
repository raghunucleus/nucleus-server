import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'regulations' })
@Unique('UQ_regulations_name', ['name'])
@Unique('UQ_regulations_code', ['code'])
export class Regulation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Calendar year the regulation was issued (e.g. 2023 for AR23). Range is
  // enforced at the DTO layer.
  @Column({ type: 'int' })
  year_of_regulation: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
