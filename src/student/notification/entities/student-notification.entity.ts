import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';
import type {
  NotificationTarget,
  StudentNotificationModuleKey,
} from '../student-notification.types';

@Entity({ name: 'student_notifications' })
// (student_id, created_at) covers the paginated list read (filter by student,
// order/seek newest first). (student_id, read_at) serves the unread-count
// query (WHERE student_id = ? AND read_at IS NULL).
@Index('IDX_student_notifications_student_id_created_at', [
  'student_id',
  'created_at',
])
@Index('IDX_student_notifications_student_id_read_at', [
  'student_id',
  'read_at',
])
export class StudentNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // Stable module key (see StudentNotificationModuleKey). Plain varchar, not a
  // Postgres enum, so adding a module never needs a migration.
  @Column({ type: 'varchar', length: 32 })
  module: StudentNotificationModuleKey;

  // Sub-kind within the module (e.g. 'message', 'fee-due') — drives client icon.
  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  // Opaque navigation metadata: the server writes it once and reads it back
  // whole; clients interpret it via their own route registry. JSONB so new
  // target shapes need no migration.
  @Column({ type: 'jsonb', nullable: true })
  target: NotificationTarget | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
