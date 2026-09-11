import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ACCESS_ALL,
  AccessibleIds,
  PermissionsService,
} from '../../rbac/permissions.service';
import { campusToday } from '../attendance-analytics/attendance-analytics.service';
import { ScopeQuery } from './dto/insights-query.dto';
import { num } from './insights.sql';

export const INSIGHTS_SCREEN_KEYS = {
  overview: 'insights.overview.view',
  attendance: 'insights.attendance.view',
  results: 'insights.results.view',
  placements: 'insights.placements.view',
  students: 'insights.students.view',
  requests: 'insights.requests.view',
} as const;

export const ALL_INSIGHTS_SCREEN_KEYS: readonly string[] =
  Object.values(INSIGHTS_SCREEN_KEYS);

/** Screen key → `web_route`, byte-identical to the catalog. Saved views pin
 *  a route to a screen so a renamed route can't strand them. */
export const INSIGHTS_ROUTES: Readonly<Record<string, string>> = {
  [INSIGHTS_SCREEN_KEYS.overview]: '/insights',
  [INSIGHTS_SCREEN_KEYS.attendance]: '/insights/attendance',
  [INSIGHTS_SCREEN_KEYS.results]: '/insights/results',
  [INSIGHTS_SCREEN_KEYS.placements]: '/insights/placements',
  [INSIGHTS_SCREEN_KEYS.students]: '/insights/students',
  [INSIGHTS_SCREEN_KEYS.requests]: '/insights/requests',
};

export interface ScopeDepartment {
  id: number;
  code: string;
  name: string;
  short_name: string | null;
}

export interface ScopeProgramme {
  id: number;
  code: string;
  name: string;
  display_name: string;
  department_id: number;
}

export interface ScopeBatch {
  pay_id: number;
  programme_id: number;
  admission_year_id: number;
  department_id: number;
  regulation_id: number | null;
  regulation_code: string | null;
  admission_year: number;
  display_year: string;
  passout_year: number;
  programme_code: string;
  programme_name: string;
  department_code: string;
  /** The batch's `ongoing` programme semester, if one is open. */
  ongoing_ps_id: number | null;
  ongoing_sem_number: number | null;
  ongoing_planned_start: string | null;
  ongoing_planned_end: string | null;
  student_count: number;
}

export interface ScopeGroup {
  id: number;
  name: string;
  code: string;
  programme_id: number;
  admission_year_id: number;
  pay_id: number;
  member_count: number;
}

/**
 * The resolved read scope for one request: the RBAC attribute triple
 * intersected with the caller's narrowing, materialised as concrete rows so
 * every domain service can hand Postgres id arrays.
 */
export interface InsightsScope {
  departments: ScopeDepartment[];
  programmes: ScopeProgramme[];
  batches: ScopeBatch[];
  groups: ScopeGroup[];
  payIds: number[];
  groupIds: number[];
  /** Non-null only when the caller narrowed to specific sections; then every
   *  student-set query adds the `student_groups` predicate. */
  groupFilter: number[] | null;
  /** More than one department holds batches — enables the comparison views. */
  multiDepartment: boolean;
  today: string;
}

const isEmpty = (v: AccessibleIds) => v !== ACCESS_ALL && v.length === 0;
const toArr = (v: AccessibleIds): number[] | null =>
  v === ACCESS_ALL ? null : v;

/**
 * Resolves what an insights caller may read.
 *
 * Per the RBAC contract every attribute is three-state: `'all'` = no filter,
 * `[]` = no access (the whole request answers empty — never "all rows"),
 * `[ids]` = filter. The three attributes are INTERSECTED: programmes are
 * looked up within the granted departments, batches within the granted
 * programmes × admission years, sections within those batches. A stale
 * `programme_ids` value pointing outside the granted departments therefore
 * drops out instead of widening the grant.
 *
 * Request-level narrowing (`ScopeQuery`) is clamped the same way the placement
 * coordinator surface does it — it can only narrow, never widen.
 */
@Injectable()
export class InsightsScopeService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Intersect a requested filter with the accessible values. */
  private clamp(
    requested: number[] | undefined,
    accessible: AccessibleIds,
  ): AccessibleIds {
    if (!requested?.length) return accessible;
    if (accessible === ACCESS_ALL) return requested;
    return requested.filter((v) => accessible.includes(v));
  }

  /**
   * `null` = the screen grants nothing (an attribute is `[]`). Otherwise a
   * scope, possibly with zero batches — consumers answer empty for that.
   */
  async resolve(
    employeeId: number,
    screenKey: string,
    q: ScopeQuery = {},
  ): Promise<InsightsScope | null> {
    const [deptAttr, progAttr, yearAttr] = await Promise.all([
      this.permissions.getAccessibleDepartmentIds(employeeId, screenKey),
      this.permissions.getAccessibleProgrammeIds(employeeId, screenKey),
      this.permissions.getAccessibleAdmissionYearIds(employeeId, screenKey),
    ]);
    if (isEmpty(deptAttr) || isEmpty(progAttr) || isEmpty(yearAttr)) {
      return null;
    }
    const deptIds = this.clamp(q.department_ids, deptAttr);
    const progIds = this.clamp(q.programme_ids, progAttr);
    const yearIds = this.clamp(q.admission_year_ids, yearAttr);
    if (isEmpty(deptIds) || isEmpty(progIds) || isEmpty(yearIds)) {
      return null;
    }

    const departments = await this.dataSource.query<ScopeDepartment[]>(
      `SELECT d.id, d.code, d.name, d.short_name
         FROM departments d
        WHERE d.is_active = TRUE
          AND ($1::int[] IS NULL OR d.id = ANY($1::int[]))
        ORDER BY d.name ASC`,
      [toArr(deptIds)],
    );
    const today = campusToday();
    if (departments.length === 0) return this.empty(today);

    const programmes = await this.dataSource.query<ScopeProgramme[]>(
      `SELECT p.id, p.code, p.name, p.display_name, p.department_id
         FROM programmes p
        WHERE p.is_active = TRUE
          AND p.department_id = ANY($1::int[])
          AND ($2::int[] IS NULL OR p.id = ANY($2::int[]))
        ORDER BY p.name ASC`,
      [departments.map((d) => d.id), toArr(progIds)],
    );
    if (programmes.length === 0) {
      return { ...this.empty(today), departments };
    }

    const batchRows = await this.dataSource.query<
      Array<
        Omit<ScopeBatch, 'student_count' | 'passout_year'> & {
          student_count: string;
          passout_year: string;
        }
      >
    >(
      `SELECT pay.id AS pay_id, pay.programme_id, pay.admission_year_id,
              pay.regulation_id, reg.code AS regulation_code,
              ay.year AS admission_year, ay.display_year,
              (ay.year + deg.duration_years) AS passout_year,
              p.department_id, p.code AS programme_code,
              p.display_name AS programme_name, d.code AS department_code,
              ops.id AS ongoing_ps_id, ops.sem_number AS ongoing_sem_number,
              ops.planned_start_date AS ongoing_planned_start,
              ops.planned_end_date AS ongoing_planned_end,
              (SELECT COUNT(*) FROM students s
                WHERE s.programme_id = pay.programme_id
                  AND s.admission_year_id = pay.admission_year_id
                  AND s.is_active = TRUE) AS student_count
         FROM programme_admission_years pay
         JOIN programmes p ON p.id = pay.programme_id
         JOIN departments d ON d.id = p.department_id
         JOIN degrees deg ON deg.id = p.degree_id
         JOIN admission_years ay ON ay.id = pay.admission_year_id
         LEFT JOIN regulations reg ON reg.id = pay.regulation_id
         LEFT JOIN LATERAL (
           SELECT ps.id, sem.sem_number,
                  ps.planned_start_date::text AS planned_start_date,
                  ps.planned_end_date::text AS planned_end_date
             FROM programme_semesters ps
             JOIN semesters sem ON sem.id = ps.semester_id
            WHERE ps.programme_id = pay.programme_id
              AND ps.admission_year_id = pay.admission_year_id
              AND ps.status = 'ongoing'
            ORDER BY sem.sem_number DESC
            LIMIT 1
         ) ops ON TRUE
        WHERE pay.is_active = TRUE
          AND pay.programme_id = ANY($1::int[])
          AND ($2::int[] IS NULL OR pay.admission_year_id = ANY($2::int[]))
          AND ($3::int[] IS NULL OR pay.id = ANY($3::int[]))
        ORDER BY d.name ASC, p.name ASC, ay.year DESC`,
      [
        programmes.map((p) => p.id),
        toArr(yearIds),
        q.programme_admission_year_ids ?? null,
      ],
    );
    const batches: ScopeBatch[] = batchRows.map((b) => ({
      ...b,
      student_count: num(b.student_count),
      passout_year: num(b.passout_year),
    }));
    const payIds = batches.map((b) => b.pay_id);
    if (payIds.length === 0) {
      return { ...this.empty(today), departments, programmes };
    }

    const groupRows = await this.dataSource.query<
      Array<Omit<ScopeGroup, 'member_count'> & { member_count: string }>
    >(
      `SELECT g.id, g.name, g.code, g.programme_id, g.admission_year_id,
              pay.id AS pay_id,
              (SELECT COUNT(*) FROM student_groups sg
                 JOIN students s ON s.id = sg.student_id
                WHERE sg.attendance_group_id = g.id AND s.is_active = TRUE) AS member_count
         FROM attendance_groups g
         JOIN programme_admission_years pay
           ON pay.programme_id = g.programme_id
          AND pay.admission_year_id = g.admission_year_id
        WHERE g.is_active = TRUE
          AND pay.id = ANY($1::int[])
          AND ($2::int[] IS NULL OR g.id = ANY($2::int[]))
        ORDER BY g.name ASC`,
      [payIds, q.attendance_group_ids ?? null],
    );
    const groups: ScopeGroup[] = groupRows.map((g) => ({
      ...g,
      member_count: num(g.member_count),
    }));
    const groupIds = groups.map((g) => g.id);
    const groupFilter = q.attendance_group_ids?.length ? groupIds : null;

    return {
      departments,
      programmes,
      batches,
      groups,
      payIds,
      groupIds,
      groupFilter,
      multiDepartment: new Set(batches.map((b) => b.department_id)).size > 1,
      today,
    };
  }

  private empty(today: string): InsightsScope {
    return {
      departments: [],
      programmes: [],
      batches: [],
      groups: [],
      payIds: [],
      groupIds: [],
      groupFilter: null,
      multiDepartment: false,
      today,
    };
  }

  /** Everything every scope bar needs in one round-trip. */
  async tree(employeeId: number, screenKey: string) {
    const scope = await this.resolve(employeeId, screenKey);
    if (!scope) {
      return {
        has_access: false,
        departments: [],
        programmes: [],
        batches: [],
        groups: [],
        today: campusToday(),
        current_passout_year: null,
      };
    }
    const year = Number(scope.today.slice(0, 4));
    const upcoming = scope.batches
      .map((b) => b.passout_year)
      .filter((y) => y >= year)
      .sort((a, b) => a - b);
    const past = scope.batches
      .map((b) => b.passout_year)
      .filter((y) => y < year)
      .sort((a, b) => b - a);
    return {
      has_access: true,
      departments: scope.departments,
      programmes: scope.programmes,
      batches: scope.batches,
      groups: scope.groups,
      today: scope.today,
      current_passout_year: upcoming[0] ?? past[0] ?? null,
    };
  }
}
