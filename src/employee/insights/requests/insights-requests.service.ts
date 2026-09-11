import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APPROVAL_REQUEST_TYPES } from '../../../requests/entities/approval-request.entity';
import { InsightsScope } from '../insights-scope.service';
import { SCOPE_STUDENTS_CTE, num, pctInt, round2 } from '../insights.sql';

const DEFAULT_WINDOW_DAYS = 90;

export interface PendingRow {
  request_type: string;
  pending: number;
  sent_back: number;
  under_3d: number;
  d3_to_7: number;
  over_7d: number;
  oldest_days: number | null;
}

export interface TurnaroundRow {
  request_type: string;
  decided: number;
  approved: number;
  rejected: number;
  median_hours: number | null;
  p90_hours: number | null;
}

export interface ApproverRow {
  employee_id: number;
  emp_code: string | null;
  emp_display_name: string | null;
  pending: number;
  oldest_days: number | null;
  decided: number;
  median_hours: number | null;
}

export interface LeaveVolumeRow {
  pay_id: number;
  group_id: number | null;
  leave_type: string;
  month: string;
  applied: number;
  approved: number;
  rejected: number;
  days: number;
}

export interface TrendRow {
  month: string;
  raised: number;
  decided: number;
  approved: number;
  rejected: number;
}

/**
 * Approval-health over the scope's students: pending backlog and its age,
 * decision turnaround, who holds the backlog, and leave volume. Everything is
 * read from `approval_requests` / `student_leaves`; the window defaults to the
 * last 90 days for the decided/raised views (pending is always "now").
 */
@Injectable()
export class InsightsRequestsService {
  constructor(private readonly dataSource: DataSource) {}

  window(scope: InsightsScope, from?: string, to?: string) {
    const end = to ?? scope.today;
    const start = from ?? shiftDays(end, -DEFAULT_WINDOW_DAYS);
    return { from: start, to: end };
  }

  private params(
    scope: InsightsScope,
    w: { from: string; to: string },
  ): [number[], number[] | null, string, string] {
    return [scope.payIds, scope.groupFilter, w.from, w.to];
  }

  async pending(scope: InsightsScope): Promise<PendingRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT ar.request_type,
              COUNT(*) FILTER (WHERE ar.status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE ar.status = 'sent_back') AS sent_back,
              COUNT(*) FILTER (WHERE ar.status = 'pending' AND ar.created_at > now() - interval '3 days') AS under_3d,
              COUNT(*) FILTER (WHERE ar.status = 'pending' AND ar.created_at <= now() - interval '3 days' AND ar.created_at > now() - interval '7 days') AS d3_to_7,
              COUNT(*) FILTER (WHERE ar.status = 'pending' AND ar.created_at <= now() - interval '7 days') AS over_7d,
              MAX(EXTRACT(EPOCH FROM (now() - ar.created_at)) / 86400) FILTER (WHERE ar.status = 'pending') AS oldest_days
         FROM approval_requests ar
         JOIN st ON st.student_id = ar.requester_student_id
        WHERE ar.status IN ('pending', 'sent_back')
        GROUP BY ar.request_type`,
      [scope.payIds, scope.groupFilter],
    );
    const byType = new Map(rows.map((r) => [r.request_type, r]));
    return APPROVAL_REQUEST_TYPES.filter((t) => t !== 'company_approval').map(
      (t) => {
        const r = byType.get(t);
        return {
          request_type: t,
          pending: num(r?.pending),
          sent_back: num(r?.sent_back),
          under_3d: num(r?.under_3d),
          d3_to_7: num(r?.d3_to_7),
          over_7d: num(r?.over_7d),
          oldest_days:
            r?.oldest_days === undefined || r.oldest_days === null
              ? null
              : Math.floor(num(r.oldest_days)),
        };
      },
    );
  }

  async turnaround(
    scope: InsightsScope,
    w: { from: string; to: string },
  ): Promise<TurnaroundRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT ar.request_type,
              COUNT(*) AS decided,
              COUNT(*) FILTER (WHERE ar.status = 'approved') AS approved,
              COUNT(*) FILTER (WHERE ar.status = 'rejected') AS rejected,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ar.decided_at - ar.created_at)) / 3600) AS median_hours,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ar.decided_at - ar.created_at)) / 3600) AS p90_hours
         FROM approval_requests ar
         JOIN st ON st.student_id = ar.requester_student_id
        WHERE ar.decided_at IS NOT NULL
          AND ar.status IN ('approved', 'rejected')
          AND ar.decided_at >= $3::date
          AND ar.decided_at < ($4::date + 1)
        GROUP BY ar.request_type
        ORDER BY ar.request_type`,
      this.params(scope, w),
    );
    return rows.map((r) => ({
      request_type: r.request_type,
      decided: num(r.decided),
      approved: num(r.approved),
      rejected: num(r.rejected),
      median_hours: round2(r.median_hours),
      p90_hours: round2(r.p90_hours),
    }));
  }

  /**
   * Who holds the pending backlog. A pending request is "on" every in-charge
   * of its attendance group (leave) or every profile verifier of its batch
   * (profile updates) — the same routing the Approvals inbox uses — so one
   * request can count against several people.
   */
  async approvers(
    scope: InsightsScope,
    w: { from: string; to: string },
  ): Promise<ApproverRow[]> {
    if (scope.payIds.length === 0) return [];
    const [pend, dec] = await Promise.all([
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE},
         pend AS (
           SELECT ar.id, ar.created_at, ar.attendance_group_id, ar.programme_admission_year_id
             FROM approval_requests ar
             JOIN st ON st.student_id = ar.requester_student_id
            WHERE ar.status = 'pending'
         ),
         routed AS (
           SELECT agi.employee_id, p.id, p.created_at
             FROM pend p
             JOIN attendance_group_incharges agi ON agi.attendance_group_id = p.attendance_group_id
           UNION ALL
           SELECT pv.employee_id, p.id, p.created_at
             FROM pend p
             JOIN programme_admission_year_profile_verifiers pv
               ON pv.programme_admission_year_id = p.programme_admission_year_id
         )
         SELECT r.employee_id, e.emp_code, e.emp_display_name,
                COUNT(DISTINCT r.id) AS pending,
                MAX(EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400) AS oldest_days
           FROM routed r
           JOIN employees e ON e.id = r.employee_id
          GROUP BY r.employee_id, e.emp_code, e.emp_display_name`,
        [scope.payIds, scope.groupFilter],
      ),
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT ar.decided_by_employee_id AS employee_id,
                e.emp_code, e.emp_display_name,
                COUNT(*) AS decided,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ar.decided_at - ar.created_at)) / 3600) AS median_hours
           FROM approval_requests ar
           JOIN st ON st.student_id = ar.requester_student_id
           JOIN employees e ON e.id = ar.decided_by_employee_id
          WHERE ar.decided_at >= $3::date AND ar.decided_at < ($4::date + 1)
            AND ar.status IN ('approved', 'rejected')
          GROUP BY ar.decided_by_employee_id, e.emp_code, e.emp_display_name`,
        this.params(scope, w),
      ),
    ]);
    const out = new Map<number, ApproverRow>();
    for (const r of pend) {
      const id = num(r.employee_id);
      out.set(id, {
        employee_id: id,
        emp_code: r.emp_code,
        emp_display_name: r.emp_display_name,
        pending: num(r.pending),
        oldest_days:
          r.oldest_days === null ? null : Math.floor(num(r.oldest_days)),
        decided: 0,
        median_hours: null,
      });
    }
    for (const r of dec) {
      const id = num(r.employee_id);
      const row = out.get(id) ?? {
        employee_id: id,
        emp_code: r.emp_code,
        emp_display_name: r.emp_display_name,
        pending: 0,
        oldest_days: null,
        decided: 0,
        median_hours: null,
      };
      row.decided = num(r.decided);
      row.median_hours = round2(r.median_hours);
      out.set(id, row);
    }
    return [...out.values()].sort(
      (a, b) =>
        b.pending - a.pending ||
        (b.oldest_days ?? 0) - (a.oldest_days ?? 0) ||
        b.decided - a.decided,
    );
  }

  async leaves(
    scope: InsightsScope,
    w: { from: string; to: string },
  ): Promise<{ rows: LeaveVolumeRow[]; approval_rate: number }> {
    if (scope.payIds.length === 0) return { rows: [], approval_rate: 0 };
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT st.pay_id, sg.attendance_group_id AS group_id, lt.name AS leave_type,
              to_char(date_trunc('month', l.from_date), 'YYYY-MM') AS month,
              COUNT(*) AS applied,
              COUNT(*) FILTER (WHERE l.status IN ('approved','cancel_requested','cancelled')) AS approved,
              COUNT(*) FILTER (WHERE l.status = 'rejected') AS rejected,
              SUM(l.to_date - l.from_date + 1) FILTER (WHERE l.status IN ('approved','cancel_requested')) AS days
         FROM student_leaves l
         JOIN st ON st.student_id = l.student_id
         JOIN leave_types lt ON lt.id = l.leave_type_id
         LEFT JOIN student_groups sg ON sg.student_id = l.student_id
        WHERE l.from_date >= $3::date AND l.from_date <= $4::date
        GROUP BY st.pay_id, sg.attendance_group_id, lt.name, date_trunc('month', l.from_date)
        ORDER BY month, st.pay_id`,
      this.params(scope, w),
    );
    const out = rows.map((r) => ({
      pay_id: num(r.pay_id),
      group_id: r.group_id === null ? null : num(r.group_id),
      leave_type: r.leave_type,
      month: r.month,
      applied: num(r.applied),
      approved: num(r.approved),
      rejected: num(r.rejected),
      days: num(r.days),
    }));
    const approved = out.reduce((a, r) => a + r.approved, 0);
    const rejected = out.reduce((a, r) => a + r.rejected, 0);
    return { rows: out, approval_rate: pctInt(approved, approved + rejected) };
  }

  async trend(
    scope: InsightsScope,
    w: { from: string; to: string },
  ): Promise<TrendRow[]> {
    if (scope.payIds.length === 0) return [];
    const [raised, decided] = await Promise.all([
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT to_char(date_trunc('month', ar.created_at), 'YYYY-MM') AS month, COUNT(*) AS n
           FROM approval_requests ar
           JOIN st ON st.student_id = ar.requester_student_id
          WHERE ar.created_at >= $3::date AND ar.created_at < ($4::date + 1)
          GROUP BY 1 ORDER BY 1`,
        this.params(scope, w),
      ),
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT to_char(date_trunc('month', ar.decided_at), 'YYYY-MM') AS month,
                COUNT(*) AS n,
                COUNT(*) FILTER (WHERE ar.status = 'approved') AS approved,
                COUNT(*) FILTER (WHERE ar.status = 'rejected') AS rejected
           FROM approval_requests ar
           JOIN st ON st.student_id = ar.requester_student_id
          WHERE ar.decided_at >= $3::date AND ar.decided_at < ($4::date + 1)
            AND ar.status IN ('approved', 'rejected')
          GROUP BY 1 ORDER BY 1`,
        this.params(scope, w),
      ),
    ]);
    const months = new Map<string, TrendRow>();
    const touch = (m: string) => {
      let row = months.get(m);
      if (!row) {
        row = { month: m, raised: 0, decided: 0, approved: 0, rejected: 0 };
        months.set(m, row);
      }
      return row;
    };
    for (const r of raised) touch(r.month).raised = num(r.n);
    for (const r of decided) {
      const row = touch(r.month);
      row.decided = num(r.n);
      row.approved = num(r.approved);
      row.rejected = num(r.rejected);
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  /** Pending requests older than seven days — the overview's KPI. */
  async pendingOver7d(scope: InsightsScope): Promise<number> {
    if (scope.payIds.length === 0) return 0;
    const [r] = await this.dataSource.query<Array<{ n: string }>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(*) AS n
         FROM approval_requests ar
         JOIN st ON st.student_id = ar.requester_student_id
        WHERE ar.status = 'pending' AND ar.created_at <= now() - interval '7 days'`,
      [scope.payIds, scope.groupFilter],
    );
    return num(r?.n);
  }
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
