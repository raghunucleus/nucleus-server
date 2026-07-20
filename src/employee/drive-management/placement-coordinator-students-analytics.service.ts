import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import { DRIVE_STUDENT_STATUS } from './drive-student-status';
import {
  CoordinatorBatch,
  PlacementCoordinatorStudentsService,
} from './placement-coordinator-students.service';

/** Postgres returns numerics (and COUNTs) as strings; normalise first. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TOP_PERFORMERS = 10;

/** Only Selected rows are an outcome; everything earlier is still in flight. */
const SELECTED = DRIVE_STUDENT_STATUS.SELECTED;

/** The batch predicate every query shares. */
const BATCH_WHERE = `s.programme_id = $1 AND s.admission_year_id = $2 AND s.is_active = TRUE`;

export interface CoordinatorCompanyRow {
  company_id: number;
  company_name: string;
  students_placed: number;
  offers: number;
  max_ctc: number | null;
  avg_ctc: number | null;
}

export interface CoordinatorOfferTypeRow {
  label: string;
  is_full_time: boolean;
  is_internship: boolean;
  offers: number;
  students: number;
}

export interface CoordinatorStudentsAnalytics {
  batch: CoordinatorBatch;
  totals: {
    total: number;
    placed: number;
    placement_pct: number;
    total_offers: number;
    highest_ctc: number | null;
    avg_ctc: number | null;
  };
  companies: CoordinatorCompanyRow[];
  offer_types: CoordinatorOfferTypeRow[];
  top_performers: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    offers: number;
    best_ctc: number | null;
  }>;
}

/**
 * Placement OUTCOMES for one of the coordinator's verified batches: who
 * actually got placed, where, and for how much.
 *
 * Deliberately not about the two readiness flags
 * (`allowed_by_dept_for_placements` / `interested_in_placements_self`) — both
 * default to true and were backfilled to true, so they carry no signal until a
 * department explicitly marks a student. Outcomes come from `drive_students`
 * rows at status Selected (60).
 *
 * CTC is read from `drive_students.ctc` — the amount actually offered to that
 * student — never from the drive's advertised `ctc_min/ctc_max` band, which is
 * NULL whenever the drive scopes money per designation.
 *
 * The caller resolves the batch through
 * `PlacementCoordinatorStudentsService.assertBatch`, so every query below is
 * already scoped to a batch this employee verifies.
 */
@Injectable()
export class PlacementCoordinatorStudentsAnalyticsService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly coordinator: PlacementCoordinatorStudentsService,
  ) {}

  async analytics(
    employeeId: number,
    payId: number,
  ): Promise<CoordinatorStudentsAnalytics> {
    const batch = await this.coordinator.assertBatch(employeeId, payId);
    const args = [batch.programme_id, batch.admission_year_id];

    const [headcount, outcome, companies, offerTypes, topPerformers] =
      await Promise.all([
        this.headcount(args),
        this.outcomeTotals(args),
        this.companies(args),
        this.offerTypes(args),
        this.topPerformers(args),
      ]);

    return {
      batch,
      totals: {
        total: headcount,
        ...outcome,
        placement_pct: headcount
          ? Math.round((outcome.placed / headcount) * 100)
          : 0,
      },
      companies,
      offer_types: offerTypes,
      top_performers: topPerformers,
    };
  }

  /** Batch size — a COUNT, not a roster load; nothing here needs the rows. */
  private async headcount(args: unknown[]): Promise<number> {
    const [row]: Array<{ total: string }> = await this.students.query(
      `SELECT COUNT(*) AS total FROM students s WHERE ${BATCH_WHERE}`,
      args,
    );
    return Number(row?.total ?? 0);
  }

  /**
   * Placed students, offers and the CTC band. `placed` counts DISTINCT
   * students: one student with three offers is one placed student.
   */
  private async outcomeTotals(args: unknown[]) {
    const [row]: Array<{
      placed: string;
      total_offers: string;
      highest_ctc: string | null;
      avg_ctc: string | null;
    }> = await this.students.query(
      `SELECT COUNT(DISTINCT s.id)  AS placed,
              COUNT(DISTINCT ds.id) AS total_offers,
              MAX(ds.ctc)           AS highest_ctc,
              AVG(ds.ctc)           AS avg_ctc
         FROM students s
         JOIN drive_students ds ON ds.student_id = s.id AND ds.status = ${SELECTED}
        WHERE ${BATCH_WHERE}`,
      args,
    );
    const avg = numOrNull(row?.avg_ctc);
    return {
      placed: Number(row?.placed ?? 0),
      total_offers: Number(row?.total_offers ?? 0),
      highest_ctc: numOrNull(row?.highest_ctc),
      // Two decimals is plenty for an LPA average and keeps the tile readable.
      avg_ctc: avg === null ? null : Math.round(avg * 100) / 100,
    };
  }

  /**
   * Where this batch went. Joins only drives → companies: bringing in
   * `drive_profiles` would fan out multi-designation drives and inflate every
   * count.
   */
  private async companies(args: unknown[]): Promise<CoordinatorCompanyRow[]> {
    const rows: Array<{
      company_id: number;
      company_name: string;
      students_placed: string;
      offers: string;
      max_ctc: string | null;
      avg_ctc: string | null;
    }> = await this.students.query(
      `SELECT c.id   AS company_id,
              c.name AS company_name,
              COUNT(DISTINCT s.id)  AS students_placed,
              COUNT(DISTINCT ds.id) AS offers,
              MAX(ds.ctc)           AS max_ctc,
              AVG(ds.ctc)           AS avg_ctc
         FROM students s
         JOIN drive_students ds ON ds.student_id = s.id AND ds.status = ${SELECTED}
         JOIN drives d          ON d.id = ds.drive_id
         JOIN companies c       ON c.id = d.company_id
        WHERE ${BATCH_WHERE}
        GROUP BY c.id, c.name
        ORDER BY students_placed DESC, max_ctc DESC NULLS LAST`,
      args,
    );
    return rows.map((r) => {
      const avg = numOrNull(r.avg_ctc);
      return {
        company_id: Number(r.company_id),
        company_name: r.company_name,
        students_placed: Number(r.students_placed),
        offers: Number(r.offers),
        max_ctc: numOrNull(r.max_ctc),
        avg_ctc: avg === null ? null : Math.round(avg * 100) / 100,
      };
    });
  }

  /**
   * Full-time vs internship, grouped by the offer type's own name.
   *
   * The effective type is `COALESCE(drive_profiles.offer_type_id,
   * drives.offer_type_id)` — drive-level and designation-level values are
   * mutually exclusive per the drive's `offer_type_scope`. Joining
   * `drive_profiles` through `ds.selected_drive_profile_id` (rather than by
   * drive) keeps this at one row per offer; it is LEFT because rows selected
   * before that column existed have it NULL and must fall back to the drive.
   *
   * Grouped by name rather than by the flags because a type may set both.
   */
  private async offerTypes(
    args: unknown[],
  ): Promise<CoordinatorOfferTypeRow[]> {
    const rows: Array<{
      label: string;
      is_full_time: boolean;
      is_internship: boolean;
      offers: string;
      students: string;
    }> = await this.students.query(
      `SELECT ot.name AS label,
              ot.is_full_time,
              ot.is_internship,
              COUNT(DISTINCT ds.id) AS offers,
              COUNT(DISTINCT s.id)  AS students
         FROM students s
         JOIN drive_students ds  ON ds.student_id = s.id AND ds.status = ${SELECTED}
         JOIN drives d           ON d.id = ds.drive_id
         LEFT JOIN drive_profiles dp ON dp.id = ds.selected_drive_profile_id
         JOIN drive_offer_types ot
           ON ot.id = COALESCE(dp.offer_type_id, d.offer_type_id)
        WHERE ${BATCH_WHERE}
        GROUP BY ot.name, ot.is_full_time, ot.is_internship
        ORDER BY offers DESC`,
      args,
    );
    return rows.map((r) => ({
      label: r.label,
      is_full_time: r.is_full_time,
      is_internship: r.is_internship,
      offers: Number(r.offers),
      students: Number(r.students),
    }));
  }

  /**
   * The batch's most-placed students. `COUNT(DISTINCT ds.id)` matches the
   * canonical `placed_count` attribute — see student-attributes.ts.
   */
  private async topPerformers(args: unknown[]) {
    const rows: Array<{
      student_id: number;
      roll_no: string;
      display_name: string;
      offers: string;
      best_ctc: string | null;
    }> = await this.students.query(
      `SELECT s.id AS student_id,
              s.student_id AS roll_no,
              s.display_name,
              COUNT(DISTINCT ds.id) AS offers,
              MAX(ds.ctc) AS best_ctc
         FROM students s
         JOIN drive_students ds ON ds.student_id = s.id AND ds.status = ${SELECTED}
        WHERE ${BATCH_WHERE}
        GROUP BY s.id, s.student_id, s.display_name
        ORDER BY offers DESC, best_ctc DESC NULLS LAST
        LIMIT ${TOP_PERFORMERS}`,
      args,
    );
    return rows.map((r) => ({
      student_id: Number(r.student_id),
      roll_no: r.roll_no,
      display_name: r.display_name,
      offers: Number(r.offers),
      best_ctc: numOrNull(r.best_ctc),
    }));
  }
}
