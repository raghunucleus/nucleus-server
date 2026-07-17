import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DriveProfile } from './drive-profile.entity';

/**
 * A JD attachment on a drive profile (a PDF/DOC spelling out the role). Bytes
 * live in the private storage bucket keyed by `file_key`; the key is never
 * exposed to clients — reads go out as a presigned `file_url`.
 *
 * Column names follow `company_attachments`: `file_key` / `file_name` /
 * `content_type` / `uploaded_by`.
 */
@Entity({ name: 'drive_profile_attachments' })
@Index('IDX_drive_profile_attachments_drive_profile_id', ['drive_profile_id'])
export class DriveProfileAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_profile_id: number;

  @ManyToOne(() => DriveProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_profile_id' })
  drive_profile: DriveProfile;

  @Column({ type: 'varchar', length: 512 })
  file_key: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  content_type: string | null;

  @Column({ type: 'int', nullable: true })
  size_bytes: number | null;

  @Column({ type: 'int', nullable: true })
  uploaded_by: number | null;

  @CreateDateColumn()
  created_at: Date;
}
