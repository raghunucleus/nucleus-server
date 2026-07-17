import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { Country } from '../../admin/entities/country.entity';
import { Degree } from '../../admin/entities/degree.entity';
import { Department } from '../../admin/entities/department.entity';
import { DiplomaBoard } from '../../admin/entities/diploma-board.entity';
import { District } from '../../admin/entities/district.entity';
import { EntranceExam } from '../../admin/entities/entrance-exam.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { SchoolBoardX } from '../../admin/entities/school-board-x.entity';
import { SchoolBoardXii } from '../../admin/entities/school-board-xii.entity';
import { State } from '../../admin/entities/state.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { JoinDef, JoinId } from './types';

/**
 * Label-join catalog. Every join is LEFT and to-one (student_groups is UNIQUE
 * on student_id), so none multiplies rows — see JoinDef.multiplying. The
 * engine adds a join only when a used select/sort facet lists its id, and
 * expands dependsOn transitively in insertion order.
 */
export const JOINS: Record<JoinId, JoinDef> = {
  programme: {
    alias: 'programme',
    entity: () => Programme,
    on: 'programme.id = s.programme_id',
  },
  department: {
    alias: 'department',
    entity: () => Department,
    on: 'department.id = programme.department_id',
    dependsOn: 'programme',
  },
  degree: {
    alias: 'degree',
    entity: () => Degree,
    on: 'degree.id = programme.degree_id',
    dependsOn: 'programme',
  },
  admission_year: {
    alias: 'admission_year',
    entity: () => AdmissionYear,
    on: 'admission_year.id = s.admission_year_id',
  },
  student_group: {
    alias: 'sg',
    entity: () => StudentGroup,
    on: 'sg.student_id = s.id',
  },
  att_group: {
    alias: 'att_group',
    entity: () => AttendanceGroup,
    on: 'att_group.id = sg.attendance_group_id',
    dependsOn: 'student_group',
  },
  home_district: {
    alias: 'home_district',
    entity: () => District,
    on: 'home_district.id = s.home_district_id',
  },
  home_state: {
    alias: 'home_state',
    entity: () => State,
    on: 'home_state.id = s.home_state_id',
  },
  home_country: {
    alias: 'home_country',
    entity: () => Country,
    on: 'home_country.id = s.home_country_id',
  },
  entrance_exam: {
    alias: 'entrance_exam',
    entity: () => EntranceExam,
    on: 'entrance_exam.id = s.entrance_exam_id',
  },
  tenth_board: {
    alias: 'tenth_board',
    entity: () => SchoolBoardX,
    on: 'tenth_board.id = s.tenth_board_id',
  },
  twelfth_board: {
    alias: 'twelfth_board',
    entity: () => SchoolBoardXii,
    on: 'twelfth_board.id = s.twelfth_board_id',
  },
  diploma_board: {
    alias: 'diploma_board',
    entity: () => DiplomaBoard,
    on: 'diploma_board.id = s.diploma_board_id',
  },
  tenth_state: {
    alias: 'tenth_state',
    entity: () => State,
    on: 'tenth_state.id = s.tenth_state_id',
  },
  twelfth_state: {
    alias: 'twelfth_state',
    entity: () => State,
    on: 'twelfth_state.id = s.twelfth_state_id',
  },
  diploma_state: {
    alias: 'diploma_state',
    entity: () => State,
    on: 'diploma_state.id = s.diploma_state_id',
  },
};

/** Expand a set of JoinIds with their transitive dependsOn chain, preserving
 *  dependency order (a join always appears after the one it depends on). */
export function expandJoins(ids: Iterable<JoinId>): JoinId[] {
  const out: JoinId[] = [];
  const seen = new Set<JoinId>();
  const add = (id: JoinId) => {
    if (seen.has(id)) return;
    const dep = JOINS[id].dependsOn;
    if (dep) add(dep);
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) add(id);
  return out;
}
