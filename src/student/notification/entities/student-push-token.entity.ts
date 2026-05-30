import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';

/**
 * An Expo push token for one of a student's devices. Registration is an upsert
 * keyed on the token: a token is globally unique, so if a device is reinstalled
 * or handed to another student, the row's `student_id` is reassigned rather than
 * duplicated — that prevents ever pushing one device under two students.
 */
@Entity({ name: 'student_push_tokens' })
@Unique('UQ_student_push_tokens_token', ['expo_push_token'])
@Index('IDX_student_push_tokens_student_id', ['student_id'])
export class StudentPushToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // The `ExpoPushToken[...]` string handed back by expo-notifications.
  @Column({ type: 'varchar', length: 255 })
  expo_push_token: string;

  // 'ios' | 'android' | 'web' — informational, and a hint for pruning.
  @Column({ type: 'varchar', length: 16, nullable: true })
  platform: string | null;

  // Stable per-install id, if the client supplies one.
  @Column({ type: 'varchar', length: 128, nullable: true })
  device_id: string | null;

  // Bumped on every (re)register so a stale-token sweep can prune dormant rows.
  @Column({ type: 'timestamptz' })
  last_seen_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
