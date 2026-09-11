import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DRIVE_STUDENT_STATUS } from '../../drive-management/drive-student-status';
import { InsightsScope } from '../insights-scope.service';
import {
  SCOPE_STUDENTS_CTE,
  num,
  numOrNull,
  pctInt,
  round2,
} from '../insights.sql';

const S = DRIVE_STUDENT_STATUS;

/**
 * Selected rows for the scope's students, with the effective offer type
 * resolved exactly as the coordinator analytics does it: the designation's
 * type when the selection recorded one, else the drive's.
 *   $3 int[] | null passout years (nullable narrowing)
 */
const SELECTIONS_CTE = `
  sel AS (
    SELECT ds.id AS ds_id, ds.student_id, ds.drive_id, ds.ctc,
           ds.outcome_marked_at, st.pay_id, st.pass_out_year,
           ot.is_full_time, ot.is_internship
      FROM drive_students ds
      JOIN st ON st.student_id = ds.student_id
      JOIN drives d ON d.id = ds.drive_id
      LEFT JOIN drive_profiles dp ON dp.id = ds.selected_drive_profile_id
      LEFT JOIN drive_offer_types ot
        ON ot.id = COALESCE(dp.offer_type_id, d.offer_type_id)
     WHERE ds.status = ${S.SELECTED}
       AND ($3::int[] IS NULL OR st.pass_out_year = ANY($3::int[]))
  )`;

export interface PlacementSummaryRow {
  pay_id: number;
  passout_year: number | null;
  cohort: number;
  eligible: number;
  placed: number;
  placed_full_time: number;
  placed_pct_cohort: number;
  placed_pct_eligible: number;
  offers: number;
  full_time_offers: number;
  internship_offers: number;
  multi_offer_students: number;
  avg_ctc: number | null;
  median_ctc: number | null;
  highest_ctc: number | null;
}

export interface FunnelResult {
  drives: number;
  totals: {
    imported: number;
    invited: number;
    accepted: number;
    denied: number;
    awaiting_response: number;
    attended: number;
    not_attended: number;
    selected: number;
    not_selected: number;
    revoked: number;
  };
  stages: Array<{ key: string; label: string; count: number }>;
  rates: {
    invite_rate: number;
    response_rate: number;
    acceptance_rate: number;
    no_show_rate: number;
    selection_rate: number;
    offer_yield: number;
  };
}

export interface CompanyRow {
  company_id: number;
  company_name: string;
  students_placed: number;
  offers: number;
  max_ctc: number | null;
  avg_ctc: number | null;
}

export interface TrendRow {
  passout_year: number | null;
  month: string;
  offers: number;
  placed_students: number;
}

export interface UnplacedResult {
  total: number;
  rows: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    pay_id: number;
    passout_year: number | null;
    cgpa: number | null;
    current_backlogs: number;
    backlog_history: boolean;
    drives_invited: number;
    drives_attended: number;
    last_activity: string | null;
  }>;
}

/**
 * Placement outcomes over the scope, keyed by batch and passout year.
 *
 * Only `SELECTED` rows are outcomes; CTC is what was actually offered to the
 * student (`drive_students.ctc`), never the drive's advertised band. Eligible =
 * both readiness flags true (NULL counts as true — both default to true and
 * carry no signal until a department explicitly marks a student).
 */
@Injectable()
export class InsightsPlacementsService {
  constructor(private readonly dataSource: DataSource) {}

  private params(
    scope: InsightsScope,
    years?: number[],
  ): [number[], number[] | null, number[] | null] {
    return [scope.payIds, scope.groupFilter, years?.length ? years : null];
  }

  async summary(
    scope: InsightsScope,
    years?: number[],
  ): Promise<PlacementSummaryRow[]> {
    if (scope.payIds.length === 0) return [];
    const [rows, multi] = await Promise.all([
      this.dataSource.query<Array<Record<string, string> & { pay_id: number }>>(
        `${SCOPE_STUDENTS_CTE},
         ${SELECTIONS_CTE}
         SELECT st.pay_id, st.pass_out_year AS passout_year,
                COUNT(DISTINCT st.student_id) AS cohort,
                COUNT(DISTINCT st.student_id) FILTER (
                  WHERE COALESCE(st.allowed_by_dept_for_placements, TRUE)
                    AND COALESCE(st.interested_in_placements_self, TRUE)) AS eligible,
                COUNT(DISTINCT sel.student_id) AS placed,
                COUNT(DISTINCT sel.student_id) FILTER (WHERE sel.is_full_time) AS placed_full_time,
                COUNT(sel.ds_id) AS offers,
                COUNT(sel.ds_id) FILTER (WHERE sel.is_full_time) AS full_time_offers,
                COUNT(sel.ds_id) FILTER (WHERE sel.is_internship) AS internship_offers,
                AVG(sel.ctc) FILTER (WHERE sel.is_full_time) AS avg_ctc,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY sel.ctc)
                  FILTER (WHERE sel.is_full_time AND sel.ctc IS NOT NULL) AS median_ctc,
                MAX(sel.ctc) AS highest_ctc
           FROM st
           LEFT JOIN sel ON sel.student_id = st.student_id
          WHERE ($3::int[] IS NULL OR st.pass_out_year = ANY($3::int[]))
          GROUP BY st.pay_id, st.pass_out_year
          ORDER BY st.pay_id`,
        this.params(scope, years),
      ),
      this.dataSource.query<Array<{ pay_id: number; students: string }>>(
        `${SCOPE_STUDENTS_CTE},
         ${SELECTIONS_CTE}
         SELECT pay_id, COUNT(*) AS students
           FROM (SELECT sel.pay_id, sel.student_id
                   FROM sel GROUP BY sel.pay_id, sel.student_id
                 HAVING COUNT(*) > 1) x
          GROUP BY pay_id`,
        this.params(scope, years),
      ),
    ]);
    const multiByPay = new Map(
      multi.map((m) => [num(m.pay_id), num(m.students)]),
    );
    return rows.map((r) => {
      const cohort = num(r.cohort);
      const eligible = num(r.eligible);
      const placed = num(r.placed);
      return {
        pay_id: num(r.pay_id),
        passout_year: numOrNull(r.passout_year),
        cohort,
        eligible,
        placed,
        placed_full_time: num(r.placed_full_time),
        placed_pct_cohort: pctInt(placed, cohort),
        placed_pct_eligible: pctInt(placed, eligible),
        offers: num(r.offers),
        full_time_offers: num(r.full_time_offers),
        internship_offers: num(r.internship_offers),
        multi_offer_students: multiByPay.get(num(r.pay_id)) ?? 0,
        avg_ctc: round2(r.avg_ctc),
        median_ctc: round2(r.median_ctc),
        highest_ctc: round2(r.highest_ctc),
      };
    });
  }

  static emptyFunnel(): FunnelResult {
    return {
      drives: 0,
      totals: {
        imported: 0,
        invited: 0,
        accepted: 0,
        denied: 0,
        awaiting_response: 0,
        attended: 0,
        not_attended: 0,
        selected: 0,
        not_selected: 0,
        revoked: 0,
      },
      stages: [],
      rates: {
        invite_rate: 0,
        response_rate: 0,
        acceptance_rate: 0,
        no_show_rate: 0,
        selection_rate: 0,
        offer_yield: 0,
      },
    };
  }

  /** Every drive_students row of the scope, aggregated into one funnel. */
  async funnel(scope: InsightsScope, years?: number[]): Promise<FunnelResult> {
    const empty = InsightsPlacementsService.emptyFunnel();
    if (scope.payIds.length === 0) return empty;
    const [r] = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(DISTINCT ds.drive_id) AS drives,
              COUNT(*) AS imported,
              COUNT(*) FILTER (WHERE ds.status >= ${S.INVITED}) AS invited,
              COUNT(*) FILTER (WHERE ds.status = ${S.INVITED}) AS awaiting_response,
              COUNT(*) FILTER (WHERE ds.status IN (${S.ACCEPTED}, ${S.NOT_ATTENDED}, ${S.SELECTED}, ${S.NOT_SELECTED})) AS accepted,
              COUNT(*) FILTER (WHERE ds.status = ${S.DENIED}) AS denied,
              COUNT(*) FILTER (WHERE ds.status IN (${S.SELECTED}, ${S.NOT_SELECTED})) AS attended,
              COUNT(*) FILTER (WHERE ds.status = ${S.NOT_ATTENDED}) AS not_attended,
              COUNT(*) FILTER (WHERE ds.status = ${S.SELECTED}) AS selected,
              COUNT(*) FILTER (WHERE ds.status = ${S.NOT_SELECTED}) AS not_selected,
              COUNT(*) FILTER (WHERE ds.status = ${S.REVOKED}) AS revoked
         FROM drive_students ds
         JOIN st ON st.student_id = ds.student_id
        WHERE ($3::int[] IS NULL OR st.pass_out_year = ANY($3::int[]))`,
      this.params(scope, years),
    );
    if (!r) return empty;
    const totals = {
      imported: num(r.imported),
      invited: num(r.invited),
      accepted: num(r.accepted),
      denied: num(r.denied),
      awaiting_response: num(r.awaiting_response),
      attended: num(r.attended),
      not_attended: num(r.not_attended),
      selected: num(r.selected),
      not_selected: num(r.not_selected),
      revoked: num(r.revoked),
    };
    const responded = totals.accepted + totals.denied;
    return {
      drives: num(r.drives),
      totals,
      stages: [
        { key: 'imported', label: 'Imported', count: totals.imported },
        { key: 'invited', label: 'Invited', count: totals.invited },
        { key: 'accepted', label: 'Accepted', count: totals.accepted },
        { key: 'attended', label: 'Attended', count: totals.attended },
        { key: 'selected', label: 'Selected', count: totals.selected },
      ],
      rates: {
        invite_rate: pctInt(totals.invited, totals.imported),
        response_rate: pctInt(responded, totals.invited),
        acceptance_rate: pctInt(totals.accepted, responded),
        no_show_rate: pctInt(totals.not_attended, totals.accepted),
        selection_rate: pctInt(totals.selected, totals.attended),
        offer_yield: pctInt(totals.selected, totals.invited),
      },
    };
  }

  async companies(
    scope: InsightsScope,
    years?: number[],
  ): Promise<CompanyRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE},
       ${SELECTIONS_CTE}
       SELECT c.id AS company_id, c.name AS company_name,
              COUNT(DISTINCT sel.student_id) AS students_placed,
              COUNT(sel.ds_id) AS offers,
              MAX(sel.ctc) AS max_ctc,
              AVG(sel.ctc) AS avg_ctc
         FROM sel
         JOIN drives d ON d.id = sel.drive_id
         JOIN companies c ON c.id = d.company_id
        GROUP BY c.id, c.name
        ORDER BY students_placed DESC, max_ctc DESC NULLS LAST
        LIMIT 50`,
      this.params(scope, years),
    );
    return rows.map((r) => ({
      company_id: num(r.company_id),
      company_name: r.company_name,
      students_placed: num(r.students_placed),
      offers: num(r.offers),
      max_ctc: round2(r.max_ctc),
      avg_ctc: round2(r.avg_ctc),
    }));
  }

  /** Month-wise selections per passout year — the client draws cumulative lines. */
  async trend(scope: InsightsScope, years?: number[]): Promise<TrendRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE},
       ${SELECTIONS_CTE}
       SELECT sel.pass_out_year AS passout_year,
              to_char(date_trunc('month', sel.outcome_marked_at), 'YYYY-MM') AS month,
              COUNT(*) AS offers,
              COUNT(DISTINCT sel.student_id) AS placed_students
         FROM sel
        WHERE sel.outcome_marked_at IS NOT NULL
        GROUP BY sel.pass_out_year, date_trunc('month', sel.outcome_marked_at)
        ORDER BY sel.pass_out_year, month`,
      this.params(scope, years),
    );
    return rows.map((r) => ({
      passout_year: numOrNull(r.passout_year),
      month: r.month,
      offers: num(r.offers),
      placed_students: num(r.placed_students),
    }));
  }

  /** Eligible students with no selection yet, best academic profile first. */
  async unplaced(
    scope: InsightsScope,
    years?: number[],
  ): Promise<UnplacedResult> {
    if (scope.payIds.length === 0) return { total: 0, rows: [] };
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(*) OVER () AS total,
              st.student_id, st.roll_no, st.display_name, st.pay_id,
              st.pass_out_year AS passout_year, st.ug_cgpa AS cgpa,
              st.current_backlogs, st.backlog_history,
              (SELECT COUNT(*) FROM drive_students ds
                WHERE ds.student_id = st.student_id AND ds.status >= ${S.INVITED}) AS drives_invited,
              (SELECT COUNT(*) FROM drive_students ds
                WHERE ds.student_id = st.student_id
                  AND ds.status IN (${S.SELECTED}, ${S.NOT_SELECTED})) AS drives_attended,
              (SELECT GREATEST(MAX(ds.invited_at), MAX(ds.responded_at), MAX(ds.outcome_marked_at))::text
                 FROM drive_students ds WHERE ds.student_id = st.student_id) AS last_activity
         FROM st
        WHERE COALESCE(st.allowed_by_dept_for_placements, TRUE)
          AND COALESCE(st.interested_in_placements_self, TRUE)
          AND ($3::int[] IS NULL OR st.pass_out_year = ANY($3::int[]))
          AND NOT EXISTS (SELECT 1 FROM drive_students ds
                           WHERE ds.student_id = st.student_id AND ds.status = ${S.SELECTED})
        ORDER BY st.ug_cgpa DESC NULLS LAST, st.roll_no ASC
        LIMIT 1000`,
      this.params(scope, years),
    );
    return {
      total: num(rows[0]?.total),
      rows: rows.map((r) => ({
        student_id: num(r.student_id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        pay_id: num(r.pay_id),
        passout_year: numOrNull(r.passout_year),
        cgpa: numOrNull(r.cgpa),
        current_backlogs: num(r.current_backlogs),
        // pg hands booleans back as JS booleans; the row type is stringly
        // for the numerics, so normalise through String().
        backlog_history: String(r.backlog_history) === 'true',
        drives_invited: num(r.drives_invited),
        drives_attended: num(r.drives_attended),
        last_activity: r.last_activity ?? null,
      })),
    };
  }
}
