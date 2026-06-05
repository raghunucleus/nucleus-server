import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentGroup } from '../../admin/entities/student-group.entity';

/**
 * One classmate with an upcoming birthday. The birth *year* is deliberately
 * never exposed — only the day/month (via `date`, the next occurrence) and a
 * `days_until` countdown — so a student's age is not leaked to their peers.
 */
export interface BirthdayPerson {
  id: number;
  display_name: string;
  /** Roll number — surfaced so the client can search by it. */
  student_id: string;
  /** Group code the student shares with the caller (their section). */
  section: string | null;
  /** Days from today until the next occurrence; 0 = today. */
  days_until: number;
  /** ISO date of the next occurrence of the birthday (no birth year). */
  date: string;
}

export interface BirthdayPage {
  /** Total matching classmates (ignoring limit/offset) — drives "has more". */
  total: number;
  items: BirthdayPerson[];
}

export interface BirthdayQuery {
  limit: number;
  offset: number;
  /** Optional search over display name OR roll number. */
  q?: string;
}

@Injectable()
export class StudentBirthdaysService {
  constructor(
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
  ) {}

  /**
   * A page of the caller's classmates — every other active student in the SAME
   * attendance group — ordered by how soon their next birthday falls (today
   * first, then the rest of the year). The next-birthday date is computed in
   * SQL so ordering + LIMIT/OFFSET are meaningful, letting the client load on
   * scroll instead of pulling a whole 1000-strong roster at once. Search is
   * applied server-side so it spans the full roster, not just loaded pages.
   *
   * The acting student id comes from the JWT (controller), never the request,
   * and the cohort is locked to that student's own attendance group, so there
   * is no way to peek at another section. Returns an empty page when the
   * student has not been placed in a group yet.
   */
  async list(studentId: number, query: BirthdayQuery): Promise<BirthdayPage> {
    // The caller's attendance group — the only cohort they may see.
    const myGroup = await this.studentGroups
      .createQueryBuilder('sg')
      .leftJoin('sg.attendance_group', 'ag')
      .select('sg.attendance_group_id', 'group_id')
      .addSelect('ag.code', 'code')
      .where('sg.student_id = :sid', { sid: studentId })
      .andWhere('sg.attendance_group_id IS NOT NULL')
      .getRawOne<{ group_id: number; code: string | null }>();

    if (!myGroup?.group_id) return { total: 0, items: [] };

    const like = query.q ? `%${escapeLike(query.q)}%` : null;

    // next_bday: shift the dob to the current year by adding whole years (the
    // pg interval-add clamps a Feb-29 dob to Feb-28 in non-leap years, so no
    // invalid date is ever built); if that has already passed this year, roll
    // to next year. days_until is a plain date subtraction. COUNT(*) OVER()
    // gives the unpaginated total in the same scan.
    const rows = await this.studentGroups.manager.query<
      Array<{
        id: number;
        display_name: string;
        student_id: string;
        date: string;
        days_until: number;
        total: number;
      }>
    >(
      `
      WITH classmates AS (
        SELECT s.id, s.display_name, s.student_id, s.dob
        FROM "student_groups" sg
        JOIN "students" s ON s.id = sg.student_id
        WHERE sg.attendance_group_id = $1
          AND s.id <> $2
          AND s.is_active = TRUE
          -- Students who hid their birthday opt out of peers' birthday lists.
          AND s.birthday_hidden = FALSE
          AND ($3::text IS NULL OR s.display_name ILIKE $3 OR s.student_id ILIKE $3)
      ),
      shifted AS (
        SELECT id, display_name, student_id,
          (dob + ((EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob))::int)
                 * INTERVAL '1 year')::date AS this_year
        FROM classmates
      ),
      dated AS (
        SELECT id, display_name, student_id,
          CASE WHEN this_year >= CURRENT_DATE THEN this_year
               ELSE (this_year + INTERVAL '1 year')::date END AS next_bday
        FROM shifted
      )
      SELECT
        id,
        display_name,
        student_id,
        next_bday::text          AS date,
        (next_bday - CURRENT_DATE) AS days_until,
        COUNT(*) OVER()::int     AS total
      FROM dated
      ORDER BY next_bday ASC, display_name ASC
      LIMIT $4 OFFSET $5
      `,
      [myGroup.group_id, studentId, like, query.limit, query.offset],
    );

    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({
        id: Number(r.id),
        display_name: r.display_name,
        student_id: r.student_id,
        section: myGroup.code,
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
