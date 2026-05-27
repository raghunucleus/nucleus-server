import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassSession } from '../entities/class-session.entity';
import { Student } from '../entities/student.entity';

export interface RosterStudent {
  id: number;
  student_id: string;
  display_name: string;
}

@Injectable()
export class RosterService {
  constructor(
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
  ) {}

  // Roster for one class session, derived fresh from current group / elective
  // membership. The session itself doesn't store the roster — it's computed
  // when the teacher opens the marking screen so transfers and elective
  // re-picks reflect immediately.
  //
  // Branch on the session shape:
  //   - Regular: every student in the session's attendance group whose
  //              programme matches the timetable's programme_semester.
  //   - Elective cohort: students in programme_semester_subject_option_students
  //              with the matching option + (scheduled) teacher. For
  //              per-group cohorts the join also filters by group via
  //              student_groups.
  async forSession(sessionId: number): Promise<RosterStudent[]> {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: ['programme_semester_subject'],
    });
    if (!session) return [];

    const isElective = session.programme_semester_subject_option_id !== null;

    if (!isElective) {
      // Regular session — all active students in the attendance group whose
      // batch matches the timetable's programme + admission year. Group +
      // batch alignment is checked at attendance_group creation, so the
      // simple group filter is enough here.
      return this.students
        .createQueryBuilder('s')
        .innerJoin('student_groups', 'sg', 'sg.student_id = s.id')
        .where('sg.attendance_group_id = :gid', {
          gid: session.attendance_group_id,
        })
        .andWhere('s.is_active = TRUE')
        .select(['s.id AS id', 's.student_id AS student_id', 's.display_name AS display_name'])
        .orderBy('s.display_name', 'ASC')
        .getRawMany<RosterStudent>();
    }

    // Elective cohort — find students whose pick matches (option_id,
    // scheduled_employee_id). For per-group cohorts, also intersect with
    // student_groups for the session's attendance_group_id.
    const qb = this.students
      .createQueryBuilder('s')
      .innerJoin(
        'programme_semester_subject_option_students',
        'pos',
        'pos.student_id = s.id',
      )
      .where('pos.programme_semester_subject_option_id = :opt', {
        opt: session.programme_semester_subject_option_id,
      })
      .andWhere('pos.employee_id = :emp', {
        emp: session.scheduled_employee_id,
      })
      .andWhere('s.is_active = TRUE');

    if (session.attendance_group_id !== null) {
      qb.innerJoin(
        'student_groups',
        'sg',
        'sg.student_id = s.id AND sg.attendance_group_id = :gid',
        { gid: session.attendance_group_id },
      );
    }

    return qb
      .select(['s.id AS id', 's.student_id AS student_id', 's.display_name AS display_name'])
      .orderBy('s.display_name', 'ASC')
      .getRawMany<RosterStudent>();
  }
}
