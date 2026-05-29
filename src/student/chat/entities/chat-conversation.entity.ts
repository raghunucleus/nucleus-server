import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';

// A one-to-one chat between two students in the same attendance group.
//
// The two participants are stored with the smaller student id always in
// `student_low_id`, so a given pair of students maps to exactly one row no
// matter who started the chat — that's what UQ_chat_conversations_pair enforces.
@Entity({ name: 'chat_conversations' })
@Unique('UQ_chat_conversations_pair', ['student_low_id', 'student_high_id'])
@Index('IDX_chat_conversations_student_low', ['student_low_id'])
@Index('IDX_chat_conversations_student_high', ['student_high_id'])
export class ChatConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_low_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_low_id' })
  student_low: Student;

  @Column({ type: 'int' })
  student_high_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_high_id' })
  student_high: Student;

  // The attendance group the two students shared when the conversation was
  // created. Kept for reference/auditing; access is re-checked on send.
  @Column({ type: 'int', nullable: true })
  attendance_group_id: number | null;

  // Read cursors: the id of the newest message each participant has read. The
  // `low`/`high` prefix matches the participant columns above. Null = nothing
  // read yet. These drive both read receipts and unread counts without a
  // per-message flag — opening a chat is a single UPDATE of one cursor.
  @Column({ type: 'int', nullable: true })
  low_last_read_message_id: number | null;

  @Column({ type: 'int', nullable: true })
  high_last_read_message_id: number | null;

  // Denormalised tail of the thread so the conversation list renders without
  // joining chat_messages. Null until the first message is sent.
  @Column({ type: 'timestamptz', nullable: true })
  last_message_at: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  last_message_preview: string | null;

  @Column({ type: 'int', nullable: true })
  last_message_sender_id: number | null;

  @CreateDateColumn()
  created_at: Date;
}
