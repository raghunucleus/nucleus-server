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
import { AttendanceGroup } from './attendance-group.entity';
import { Employee } from './employee.entity';

// Join row linking an attendance group to one of its in-charge employees. A
// group can have several in-charges; each (group, employee) pair is unique.
// Authority for the incharge surface pivots on these rows — an employee owns
// every group they appear against here.
@Entity({ name: 'attendance_group_incharges' })
@Unique('UQ_att_group_incharges_group_employee', [
  'attendance_group_id',
  'employee_id',
])
@Index('IDX_att_group_incharges_employee_id', ['employee_id'])
export class AttendanceGroupIncharge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  attendance_group_id: number;

  @ManyToOne(() => AttendanceGroup, (g) => g.incharges, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup;

  @Column({ type: 'int' })
  employee_id: number;

  // Non-eager to avoid a cycle with Employee.department (which is eager).
  // CASCADE so deleting the employee drops their in-charge links rather than
  // leaving dangling rows.
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
