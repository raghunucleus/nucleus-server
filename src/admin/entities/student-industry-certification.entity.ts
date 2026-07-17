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
import { IndustryCertification } from './industry-certification.entity';
import { Student } from './student.entity';

/**
 * One earned industry certification of one student (the repeatable
 * certifications group on the profile). Created when an approver approves the
 * certification item of a `profile_update` request, or directly by an admin.
 * The supporting certificate file is mandatory and lives in PRIVATE object
 * storage (`student-certificates/<studentId>/<uuid>.<ext>`) — served to
 * approvers/admins via short-lived presigned URLs only, unlike the public
 * resume.
 */
@Entity({ name: 'student_industry_certifications' })
@Unique('UQ_student_industry_certifications_student_id_certification_id', [
  'student_id',
  'industry_certification_id',
])
export class StudentIndustryCertification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'int' })
  industry_certification_id: number;

  @ManyToOne(() => IndustryCertification, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'industry_certification_id' })
  industry_certification: IndustryCertification;

  @Column({ type: 'text' })
  certificate_file_key: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
