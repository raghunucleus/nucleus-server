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
import { Employee } from './employee.entity';
import { ProgrammeAdmissionYear } from './programme-admission-year.entity';

// Join row linking a (programme × admission-year) batch to one of its profile
// verifiers — an employee responsible for verifying the details of that batch's
// students. A batch can have several verifiers; each (batch, employee) pair is
// unique.
@Entity({ name: 'programme_admission_year_profile_verifiers' })
@Unique('UQ_pay_profile_verifiers_pay_employee', [
  'programme_admission_year_id',
  'employee_id',
])
@Index('IDX_pay_profile_verifiers_employee_id', ['employee_id'])
export class ProgrammeAdmissionYearProfileVerifier {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_admission_year_id: number;

  @ManyToOne(
    () => ProgrammeAdmissionYear,
    (pay) => pay.profile_verifiers,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'programme_admission_year_id' })
  programme_admission_year: ProgrammeAdmissionYear;

  @Column({ type: 'int' })
  employee_id: number;

  // Non-eager to avoid a cycle with Employee.department (which is eager).
  // CASCADE so deleting the employee drops their verifier links rather than
  // leaving dangling rows.
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
