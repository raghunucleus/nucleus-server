import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ClassSession } from './class-session.entity';
import { Employee } from './employee.entity';

export type ClassSessionAuditAction =
  | 'create'
  | 'edit'
  | 'cancel'
  | 'uncancel'
  | 'substitute'
  | 'move'
  | 'reschedule'
  | 'amend'
  | 'mark_attendance'
  // A leave approval / cancellation flipped this session's attendance rows
  // (absent ↔ leave) for one student — written by the leave request handlers,
  // not by a teacher. `reason` carries `leave:<id>` / `leave_cancel:<id>`.
  | 'leave_sync';

// Append-only audit row inserted in the same transaction as any
// `class_sessions` mutation. `before`/`after` carry the relevant subset of
// session columns as JSON so reviewers can see what changed without crossing
// into the temporal-table rabbit hole.
@Entity({ name: 'class_session_audit_logs' })
@Index('IDX_cs_audit_class_session_id', ['class_session_id'])
@Index('IDX_cs_audit_performed_by_employee_id', ['performed_by_employee_id'])
@Index('IDX_cs_audit_action_created_at', ['action', 'created_at'])
export class ClassSessionAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  // Nullable so we can keep audit rows if a session is ever hard-deleted
  // (which the design avoids, but the FK shouldn't be the gate that prevents
  // it).
  @Column({ type: 'int', nullable: true })
  class_session_id: number | null;

  @ManyToOne(() => ClassSession, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'class_session_id' })
  class_session: ClassSession | null;

  @Column({ type: 'varchar', length: 32 })
  action: ClassSessionAuditAction;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason: string | null;

  @Column({ type: 'int' })
  performed_by_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'performed_by_employee_id' })
  performed_by: Employee;

  @CreateDateColumn()
  created_at: Date;
}
