import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Admin } from './admin.entity';

@Entity({ name: 'admin_recovery_codes' })
@Index('IDX_admin_recovery_codes_admin_id', ['admin_id'])
export class AdminRecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  admin_id: number;

  @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'admin_id' })
  admin: Admin;

  // Bcrypt hash of the plaintext recovery code shown to the admin once at enrolment.
  @Column({ type: 'varchar', length: 255 })
  code_hash: string;

  @Column({ type: 'timestamp', nullable: true })
  used_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
