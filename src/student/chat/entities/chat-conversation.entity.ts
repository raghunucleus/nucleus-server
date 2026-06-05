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

  // Consent gate. A conversation opens as `pending`: the first message is a
  // request the recipient must explicitly accept before either side can keep
  // talking. Accepting flips it to `accepted` (the only other value). Legacy
  // rows were backfilled to `accepted`. A DB CHECK constrains the values.
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'accepted';

  // Who sent the invite (the request initiator). Null for legacy rows. FK is
  // ON DELETE SET NULL so deleting the inviter never deletes a conversation the
  // other party still holds.
  @Column({ type: 'int', nullable: true })
  initiated_by_id: number | null;

  @ManyToOne(() => Student, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'initiated_by_id' })
  initiated_by: Student | null;

  // Per-participant mute flags (the `low`/`high` prefix matches the participant
  // columns). A muted participant still receives messages and accrues unread —
  // muting only suppresses the OS push notification for that participant.
  @Column({ type: 'boolean', default: false })
  low_muted: boolean;

  @Column({ type: 'boolean', default: false })
  high_muted: boolean;

  // Per-participant block flags: `low_blocked` = the LOW participant has blocked
  // the HIGH participant (low no longer wants their messages), and vice versa.
  // Blocking is silent to the blocked sender — see ChatService.assertSend.
  @Column({ type: 'boolean', default: false })
  low_blocked: boolean;

  @Column({ type: 'boolean', default: false })
  high_blocked: boolean;

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
