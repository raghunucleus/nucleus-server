import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';

/**
 * One colleague with an upcoming birthday. The birth *year* is deliberately
 * never exposed — only the day/month (via `date`, the next occurrence) and a
 * `days_until` countdown — so an employee's age is not leaked to their peers.
 */
export interface BirthdayPerson {
  id: number;
  display_name: string;
  /** Employee code — surfaced so the client can search by it. */
  emp_code: string;
  /** Name of the department shared with the caller. */
  department: string | null;
  /** Days from today until the next occurrence; 0 = today. */
  days_until: number;
  /** ISO date of the next occurrence of the birthday (no birth year). */
  date: string;
}

export interface BirthdayPage {
  /** Total matching colleagues (ignoring limit/offset) — drives "has more". */
  total: number;
  items: BirthdayPerson[];
}

export interface BirthdayQuery {
  limit: number;
  offset: number;
  /** Optional search over display name OR employee code. */
  q?: string;
}

@Injectable()
export class EmployeeBirthdaysService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  /**
   * A page of the caller's colleagues — every other active employee in the SAME
   * department who has a recorded date of birth — ordered by how soon their
   * next birthday falls (today first, then the rest of the year). The
   * next-birthday date is computed in SQL so ordering + LIMIT/OFFSET are
   * meaningful, letting the client load on scroll instead of pulling the whole
   * roster at once. Search is applied server-side so it spans the full
   * department, not just loaded pages.
   *
   * The acting employee id comes from the JWT (controller), never the request,
   * and the cohort is locked to that employee's own department, so there is no
   * way to peek at another department. Returns an empty page when the employee
   * has no department (shouldn't happen — department_id is NOT NULL).
   */
  async list(employeeId: number, query: BirthdayQuery): Promise<BirthdayPage> {
    // The caller's own department — the only cohort they may see.
    const me = await this.employees
      .createQueryBuilder('e')
      .leftJoin('e.department', 'd')
      .select('e.department_id', 'department_id')
      .addSelect('d.name', 'department')
      .where('e.id = :id', { id: employeeId })
      .getRawOne<{ department_id: number; department: string | null }>();

    if (!me?.department_id) return { total: 0, items: [] };

    const like = query.q ? `%${escapeLike(query.q)}%` : null;

    // next_bday: shift the dob to the current year by adding whole years (the
    // pg interval-add clamps a Feb-29 dob to Feb-28 in non-leap years, so no
    // invalid date is ever built); if that has already passed this year, roll
    // to next year. days_until is a plain date subtraction. COUNT(*) OVER()
    // gives the unpaginated total in the same scan.
    const rows = await this.employees.manager.query<
      Array<{
        id: number;
        emp_display_name: string;
        emp_code: string;
        date: string;
        days_until: number;
        total: number;
      }>
    >(
      `
      WITH colleagues AS (
        SELECT e.id, e.emp_display_name, e.emp_code, e.dob
        FROM "employees" e
        WHERE e.department_id = $1
          AND e.id <> $2
          AND e.is_active = TRUE
          AND e.dob IS NOT NULL
          AND ($3::text IS NULL OR e.emp_display_name ILIKE $3 OR e.emp_code ILIKE $3)
      ),
      shifted AS (
        SELECT id, emp_display_name, emp_code,
          (dob + ((EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob))::int)
                 * INTERVAL '1 year')::date AS this_year
        FROM colleagues
      ),
      dated AS (
        SELECT id, emp_display_name, emp_code,
          CASE WHEN this_year >= CURRENT_DATE THEN this_year
               ELSE (this_year + INTERVAL '1 year')::date END AS next_bday
        FROM shifted
      )
      SELECT
        id,
        emp_display_name,
        emp_code,
        next_bday::text          AS date,
        (next_bday - CURRENT_DATE) AS days_until,
        COUNT(*) OVER()::int     AS total
      FROM dated
      ORDER BY next_bday ASC, emp_display_name ASC
      LIMIT $4 OFFSET $5
      `,
      [me.department_id, employeeId, like, query.limit, query.offset],
    );

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({
        id: Number(r.id),
        display_name: r.emp_display_name,
        emp_code: r.emp_code,
        department: me.department,
        days_until: Number(r.days_until),
        date: r.date,
      })),
    };
  }
}

/** Escape LIKE/ILIKE wildcards so a user's `%` or `_` is treated literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
