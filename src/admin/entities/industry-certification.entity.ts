import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'industry_certifications' })
@Unique('UQ_industry_certifications_name', ['name'])
@Unique('UQ_industry_certifications_code', ['code'])
export class IndustryCertification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Awarding organisation (e.g. AWS, Cisco, Microsoft). Free-form by design —
  // there is no vendor master to reference, so this is not an FK.
  @Column({ type: 'varchar', length: 128, nullable: true })
  issuing_body: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
