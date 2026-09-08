import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PermissionsService } from '../../rbac/permissions.service';
import { AdmissionYear } from '../entities/admission-year.entity';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { AttendanceGroupIncharge } from '../entities/attendance-group-incharge.entity';
import { Employee } from '../entities/employee.entity';
import { Programme } from '../entities/programme.entity';
import { Student } from '../entities/student.entity';
import { StudentGroup } from '../entities/student-group.entity';

@Injectable()
export class AttendanceGroupsService {
  constructor(
    @InjectRepository(AttendanceGroup)
    private readonly groups: Repository<AttendanceGroup>,
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
  ) {}

  // All attendance groups (with their student members) for one programme ×
  // admission-year batch. A member is a student_groups row whose
  // attendance_group_id points at the group. (RBAC picker uses a separate
  // flat fetcher in src/rbac/catalog/attribute-fetchers.ts — this endpoint
  // stays strictly per-batch.)
  async list(
    programmeId: number,
    admissionYearId: number,
  ): Promise<AttendanceGroup[]> {
    return this.groups
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'members')
      .leftJoinAndSelect('members.student', 'member_student')
      .leftJoin('g.incharges', 'gi')
      .leftJoin('gi.employee', 'gie')
      .addSelect([
        'gi.id',
        'gi.attendance_group_id',
        'gi.employee_id',
        'gie.id',
        'gie.emp_code',
        'gie.emp_display_name',
      ])
      .where('g.programme_id = :pid', { pid: programmeId })
      .andWhere('g.admission_year_id = :ayid', { ayid: admissionYearId })
      .orderBy('g.name', 'ASC')
      .addOrderBy('member_student.student_id', 'ASC')
      .addOrderBy('gie.emp_display_name', 'ASC')
      .getMany();
  }

  async getOne(id: number): Promise<AttendanceGroup> {
    const row = await this.groups
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'members')
      .leftJoinAndSelect('members.student', 'member_student')
      .leftJoin('g.incharges', 'gi')
      .leftJoin('gi.employee', 'gie')
      .addSelect([
        'gi.id',
        'gi.attendance_group_id',
        'gi.employee_id',
        'gie.id',
        'gie.emp_code',
        'gie.emp_display_name',
      ])
      .where('g.id = :id', { id })
      .orderBy('member_student.student_id', 'ASC')
      .addOrderBy('gie.emp_display_name', 'ASC')
      .getOne();
    if (!row) throw new NotFoundException('Attendance group not found');
    return row;
  }

  // Students eligible for this batch's attendance groups — the "unassigned"
  // pool: active students of the programme × admission year who are not yet in
  // any attendance group. Members of the batch's own groups are excluded too —
  // they appear inside their group.
  async listEligibleStudents(
    programmeId: number,
    admissionYearId: number,
  ): Promise<Student[]> {
    return this.students
      .createQueryBuilder('s')
      .leftJoin(StudentGroup, 'sg', 'sg.student_id = s.id')
      .where('s.programme_id = :pid', { pid: programmeId })
      .andWhere('s.admission_year_id = :ayid', { ayid: admissionYearId })
      .andWhere('s.is_active = TRUE')
      .andWhere('sg.attendance_group_id IS NULL')
      .orderBy('s.student_id', 'ASC')
      .getMany();
  }

  async create(input: {
    programme_id: number;
    admission_year_id: number;
    name: string;
    code: string;
    group_incharge_employee_ids: number[];
    description: string | null;
  }): Promise<AttendanceGroup> {
    const programme = await this.programmes.findOne({
      where: { id: input.programme_id },
    });
    if (!programme) {
      throw new BadRequestException('Selected programme does not exist');
    }
    const year = await this.admissionYears.findOne({
      where: { id: input.admission_year_id },
    });
    if (!year) {
      throw new BadRequestException('Selected admission year does not exist');
    }
    await this.assertEmployeesExist(input.group_incharge_employee_ids);
    await this.assertNameUnique(
      input.programme_id,
      input.admission_year_id,
      input.name,
    );
    await this.assertCodeUnique(
      input.programme_id,
      input.admission_year_id,
      input.code,
    );
    const saved = await this.dataSource.transaction(async (tx) => {
      const groupsRepo = tx.getRepository(AttendanceGroup);
      const inchargeRepo = tx.getRepository(AttendanceGroupIncharge);
      const group = await groupsRepo.save(
        groupsRepo.create({
          programme_id: input.programme_id,
          admission_year_id: input.admission_year_id,
          name: input.name,
          code: input.code,
          description: input.description,
        }),
      );
      await inchargeRepo.save(
        input.group_incharge_employee_ids.map((eid) =>
          inchargeRepo.create({
            attendance_group_id: group.id,
            employee_id: eid,
          }),
        ),
      );
      return group;
    });
    await this.invalidateInchargeAccess(input.group_incharge_employee_ids);
    return this.getOne(saved.id);
  }

  async update(
    id: number,
    patch: {
      name: string;
      code: string;
      group_incharge_employee_ids: number[];
      description: string | null;
    },
  ): Promise<AttendanceGroup> {
    const row = await this.groups.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attendance group not found');
    if (patch.name !== row.name) {
      await this.assertNameUnique(
        row.programme_id,
        row.admission_year_id,
        patch.name,
        id,
      );
    }
    if (patch.code !== row.code) {
      await this.assertCodeUnique(
        row.programme_id,
        row.admission_year_id,
        patch.code,
        id,
      );
    }
    await this.assertEmployeesExist(patch.group_incharge_employee_ids);
    const before = await this.dataSource.transaction(async (tx) => {
      const groupsRepo = tx.getRepository(AttendanceGroup);
      const inchargeRepo = tx.getRepository(AttendanceGroupIncharge);
      row.name = patch.name;
      row.code = patch.code;
      row.description = patch.description;
      await groupsRepo.save(row);
      // Replace the in-charge set: clear the existing links, re-insert the
      // requested ones. Nothing references join-row ids, so a wholesale
      // swap is safe and keeps the logic trivial.
      const existing = await inchargeRepo.find({
        where: { attendance_group_id: id },
        select: { employee_id: true },
      });
      await inchargeRepo.delete({ attendance_group_id: id });
      await inchargeRepo.save(
        patch.group_incharge_employee_ids.map((eid) =>
          inchargeRepo.create({
            attendance_group_id: id,
            employee_id: eid,
          }),
        ),
      );
      return existing.map((e) => e.employee_id);
    });
    await this.invalidateInchargeAccess([
      ...before,
      ...patch.group_incharge_employee_ids,
    ]);
    return this.getOne(id);
  }

  // The employee Approvals screen is DERIVED from in-charge membership
  // (PermissionsService.deriveRequestScreens — leave requests route to a
  // group's in-charges) and the derivation result is cached — bust old ∪ new
  // so the change takes effect immediately rather than after the cache TTL.
  private async invalidateInchargeAccess(employeeIds: number[]): Promise<void> {
    await Promise.all(
      [...new Set(employeeIds)].map((id) => this.permissions.invalidate(id)),
    );
  }

  // Toggle a group's active flag. Groups are never hard-deleted — deactivation
  // takes the slot delete used to fill, so we apply the same precondition:
  // the group must have no members. Move or remove its students first.
  async setActive(id: number, active: boolean): Promise<AttendanceGroup> {
    const row = await this.groups.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attendance group not found');
    if (row.is_active === active) return this.getOne(id);
    if (!active) {
      const memberCount = await this.studentGroups.count({
        where: { attendance_group_id: id },
      });
      if (memberCount > 0) {
        throw new ConflictException(
          `This group still has ${memberCount} student${
            memberCount === 1 ? '' : 's'
          } — move or remove them before deactivating it.`,
        );
      }
    }
    row.is_active = active;
    await this.groups.save(row);
    return this.getOne(id);
  }

  // Place students in a group by setting their student_groups.attendance_group
  // column. Each student has a single attendance group, so this naturally
  // moves a student out of any group they were previously in.
  async addStudents(
    groupId: number,
    studentIds: number[],
  ): Promise<AttendanceGroup> {
    // Strict check: never add students to a group that no longer exists.
    const group = await this.groups.findOne({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException(
        'Attendance group not found — it may have been deleted.',
      );
    }
    if (!group.is_active) {
      throw new ConflictException(
        'This attendance group is inactive — reactivate it before adding students.',
      );
    }

    // Validate the students up-front: each must exist, be active, and belong
    // to this batch (same programme + admission year as the group).
    const found = await this.students
      .createQueryBuilder('s')
      .where('s.id IN (:...ids)', { ids: studentIds })
      .getMany();
    const byId = new Map(found.map((s) => [s.id, s]));
    const missing = studentIds.filter((sid) => !byId.has(sid));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown student id(s): ${missing.join(', ')}`,
      );
    }
    const rows = studentIds.map((sid) => byId.get(sid)!);
    const inactive = rows.filter((s) => !s.is_active);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Inactive students can't be added: ${inactive
          .map((s) => s.student_id)
          .join(', ')}`,
      );
    }
    const wrongBatch = rows.filter(
      (s) =>
        s.programme_id !== group.programme_id ||
        s.admission_year_id !== group.admission_year_id,
    );
    if (wrongBatch.length > 0) {
      throw new BadRequestException(
        `Some students don't belong to this programme & admission year batch: ${wrongBatch
          .map((s) => s.student_id)
          .join(', ')}`,
      );
    }

    // Upsert each student's row: update the attendance_group column for those
    // who already have a student_groups row, insert one for those who don't.
    await this.dataSource.transaction(async (tx) => {
      const sgRepo = tx.getRepository(StudentGroup);
      const existing = await sgRepo.find({
        where: { student_id: In(studentIds) },
        select: { student_id: true },
      });
      const existingIds = new Set(existing.map((r) => r.student_id));
      await sgRepo.update(
        { student_id: In(studentIds) },
        { attendance_group_id: groupId },
      );
      const toInsert = studentIds.filter((sid) => !existingIds.has(sid));
      if (toInsert.length > 0) {
        await sgRepo.save(
          toInsert.map((sid) =>
            sgRepo.create({
              student_id: sid,
              attendance_group_id: groupId,
            }),
          ),
        );
      }
    });

    return this.getOne(groupId);
  }

  // Remove a student from a group — clears their attendance_group column
  // (only if they are actually in this group). The student_groups row stays,
  // ready for other group columns.
  async removeStudent(
    groupId: number,
    studentId: number,
  ): Promise<AttendanceGroup> {
    const group = await this.groups.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Attendance group not found');
    await this.studentGroups.update(
      { student_id: studentId, attendance_group_id: groupId },
      { attendance_group_id: null },
    );
    return this.getOne(groupId);
  }

  private async assertEmployeesExist(employeeIds: number[]): Promise<void> {
    const found = await this.employees.find({
      where: { id: In(employeeIds) },
      select: { id: true },
    });
    const foundIds = new Set(found.map((e) => e.id));
    const missing = employeeIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Selected group in-charge employee(s) do not exist: ${missing.join(', ')}`,
      );
    }
  }

  private async assertNameUnique(
    programmeId: number,
    admissionYearId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const qb = this.groups
      .createQueryBuilder('g')
      .where('g.programme_id = :pid', { pid: programmeId })
      .andWhere('g.admission_year_id = :ayid', { ayid: admissionYearId })
      .andWhere('LOWER(g.name) = LOWER(:name)', { name });
    if (excludeId !== undefined) qb.andWhere('g.id != :id', { id: excludeId });
    if (await qb.getOne()) {
      throw new ConflictException(
        'A group with this name already exists for this programme & year.',
      );
    }
  }

  private async assertCodeUnique(
    programmeId: number,
    admissionYearId: number,
    code: string,
    excludeId?: number,
  ): Promise<void> {
    const qb = this.groups
      .createQueryBuilder('g')
      .where('g.programme_id = :pid', { pid: programmeId })
      .andWhere('g.admission_year_id = :ayid', { ayid: admissionYearId })
      .andWhere('LOWER(g.code) = LOWER(:code)', { code });
    if (excludeId !== undefined) qb.andWhere('g.id != :id', { id: excludeId });
    if (await qb.getOne()) {
      throw new ConflictException(
        'A group with this code already exists for this programme & year.',
      );
    }
  }
}
