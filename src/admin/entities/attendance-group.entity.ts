import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AdmissionYear } from './admission-year.entity';
import { AttendanceGroupIncharge } from './attendance-group-incharge.entity';
import { Programme } from './programme.entity';
import { StudentGroup } from './student-group.entity';

// A named cohort of students within one programme × admission-year batch.
// Students are split into attendance groups once for the whole batch — the
// grouping carries across every semester of that batch, and each group can
// later be linked to its own timetable. A student belongs to at most one
// attendance group per batch — enforced by student_groups' one-row-per-student
// shape.
@Entity({ name: 'attendance_groups' })
@Unique('UQ_att_groups_prog_year_name', [
  'programme_id',
  'admission_year_id',
  'name',
])
@Unique('UQ_att_groups_prog_year_code', [
  'programme_id',
  'admission_year_id',
  'code',
])
@Index('IDX_att_groups_programme_id_admission_year_id', [
  'programme_id',
  'admission_year_id',
])
export class AttendanceGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_id: number;

  @ManyToOne(() => Programme, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'programme_id' })
  programme: Programme;

  @Column({ type: 'int' })
  admission_year_id: number;

  @ManyToOne(() => AdmissionYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'admission_year_id' })
  admission_year: AdmissionYear;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  // Short identifier shown alongside name (e.g. "A", "MORN-1"). Unique within
  // a programme × admission-year batch.
  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Optional free-text note about the group (e.g. "Morning lab batch").
  @Column({ type: 'varchar', length: 256, nullable: true })
  description: string | null;

  // Employees assigned as the group's in-charges. A group can have several;
  // every in-charge sees and manages the group's schedule. New groups are
  // required to set at least one via the DTO. Loaded via an explicit leftJoin
  // in the service.
  @OneToMany(() => AttendanceGroupIncharge, (i) => i.attendance_group)
  incharges: AttendanceGroupIncharge[];

  // Soft-delete flag. Groups can never be hard-deleted — deactivating hides
  // them from new assignments while preserving historical membership and any
  // timetable links.
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Members of the group — student_groups rows whose attendance_group_id
  // points here. Loaded via an explicit leftJoin in the service.
  @OneToMany(() => StudentGroup, (m) => m.attendance_group)
  members: StudentGroup[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
