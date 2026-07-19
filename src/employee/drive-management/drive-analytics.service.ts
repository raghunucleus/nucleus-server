import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DRIVE_STUDENT_STATUS,
  DRIVE_STUDENT_STATUS_LABELS,
  DriveStudentStatus,
} from './drive-student-status';
import { Drive } from './entities/drive.entity';
import { DriveStudent } from './entities/drive-student.entity';

/** How long an invite may sit unanswered before it counts as "stale". */
const STALE_INVITE_DAYS = 7;
/** Cap on the distinct deny/revoke reasons surfaced per list. */
const TOP_REASONS = 8;

export interface DriveAnalyticsTotals {
  /** Every student ever imported into the drive (all rows). */
  total: number;
  /** Currently at Imported (10) — imported but not yet invited. */
  imported: number;
  /** Ever reached Invited (status ≠ 10). */
  invited: number;
  /** Ever Accepted (30/50/60/70). */
  accepted: number;
  denied: number;
  not_attended: number;
  selected: number;
  not_selected: number;
  revoked: number;
}

export interface FunnelStage {
  key: 'imported' | 'invited' | 'accepted' | 'selected';
  label: string;
  count: number;
}

export interface DriveAnalyticsRates {
  /** invited / imported */
  invite_rate: number | null;
  /** (accepted + denied) / invited */
  response_rate: number | null;
  /** accepted / invited */
  acceptance_rate: number | null;
  /** not_attended / accepted */
  no_show_rate: number | null;
  /** selected / (selected + not_selected) */
  selection_rate: number | null;
  /** selected / imported */
  offer_yield: number | null;
}

export interface StatusSlice {
  status: number;
  label: string;
  count: number;
}

export interface BreakdownRow {
  label: string;
  imported: number;
  accepted: number;
  selected: number;
}

export interface CgpaBandRow {
  label: string;
  imported: number;
  selected: number;
  avg_cgpa: number | null;
}

export interface ReasonRow {
  reason: string;
  count: number;
}

export interface DriveAnalytics {
  totals: DriveAnalyticsTotals;
  funnel: FunnelStage[];
  rates: DriveAnalyticsRates;
  status_distribution: StatusSlice[];
  breakdowns: {
    programme: BreakdownRow[];
    gender: BreakdownRow[];
    entry_type: BreakdownRow[];
    passout_year: BreakdownRow[];
    cgpa_band: CgpaBandRow[];
  };
  cgpa: { avg_pool: number | null; avg_selected: number | null };
  response_time: {
    avg_hours: number | null;
    buckets: { label: string; count: number }[];
  };
  reasons: { denied: ReasonRow[]; revoked: ReasonRow[] };
  attention: {
    not_invited: number;
    awaiting_response: number;
    stale_invites: number;
    awaiting_outcome: number;
  };
}

const ALL_STATUSES: DriveStudentStatus[] = [10, 20, 30, 40, 50, 60, 70, 80];
/** Ever reached "Accepted or beyond" — the funnel's accepted stage. */
const ACCEPTED_OR_PAST = [30, 50, 60, 70];
const ENTRY_TYPE_LABELS: Record<number, string> = {
  1: 'Regular',
  2: 'Lateral',
};
/** Fixed band order so the CGPA breakdown always renders low → high. */
const CGPA_BAND_ORDER = ['< 6', '6 – 7', '7 – 8', '8 – 9', '9 – 10', 'No CGPA'];

/**
 * Read-only, per-drive placement analytics: the conversion funnel, status mix,
 * demographic breakdowns, response velocity and reason rollups — computed with a
 * handful of grouped aggregate queries over `drive_students` (joined to
 * `students`/`programmes`), never per-status round-trips.
 *
 * Gated by the same institution-wide `drive_management.drives.manage` screen as
 * the rest of the drive surface (see the controller). Money/CTC is deliberately
 * absent — it's drive-level static already shown on the Overview tab, not a
 * per-student metric.
 */
@Injectable()
export class DriveAnalyticsService {
  constructor(
    @InjectRepository(DriveStudent)
    private readonly members: Repository<DriveStudent>,
    @InjectRepository(Drive)
    private readonly drives: Repository<Drive>,
  ) {}

  async analytics(driveId: number): Promise<DriveAnalytics> {
    await this.assertDrive(driveId);

    const [
      statusRows,
      programme,
      gender,
      entryType,
      passoutYear,
      cgpaBand,
      cgpaAvgRow,
      responseRow,
      staleRow,
      deniedReasons,
      revokedReasons,
    ] = await Promise.all([
      this.statusCounts(driveId),
      this.breakdown(
        driveId,
        'p.display_name',
        'LEFT JOIN programmes p ON p.id = s.programme_id',
      ),
      this.breakdown(driveId, 's.gender'),
      this.breakdown(driveId, 's.entry_type'),
      this.breakdown(driveId, 's.pass_out_year'),
      this.cgpaBands(driveId),
      this.cgpaAverages(driveId),
      this.responseTime(driveId),
      this.staleInvites(driveId),
      this.reasons(driveId, DRIVE_STUDENT_STATUS.DENIED),
      this.reasons(driveId, DRIVE_STUDENT_STATUS.REVOKED),
    ]);

    // Status → count, zero-filled for every code so the UI never sees a gap.
    const c: Record<number, number> = {};
    for (const s of ALL_STATUSES) c[s] = 0;
    for (const r of statusRows) c[Number(r.status)] = Number(r.count);

    const total = ALL_STATUSES.reduce((sum, s) => sum + c[s], 0);
    const imported = c[10];
    const invited = total - c[10];
    const accepted = c[30] + c[50] + c[60] + c[70];
    const denied = c[40];
    const not_attended = c[50];
    const selected = c[60];
    const not_selected = c[70];
    const revoked = c[80];
    const responded = accepted + denied;
    const attended = selected + not_selected;

    const rate = (num: number, den: number): number | null =>
      den > 0 ? num / den : null;

    return {
      totals: {
        total,
        imported,
        invited,
        accepted,
        denied,
        not_attended,
        selected,
        not_selected,
        revoked,
      },
      funnel: [
        { key: 'imported', label: 'Imported', count: total },
        { key: 'invited', label: 'Invited', count: invited },
        { key: 'accepted', label: 'Accepted', count: accepted },
        { key: 'selected', label: 'Selected', count: selected },
      ],
      rates: {
        invite_rate: rate(invited, total),
        response_rate: rate(responded, invited),
        acceptance_rate: rate(accepted, invited),
        no_show_rate: rate(not_attended, accepted),
        selection_rate: rate(selected, attended),
        offer_yield: rate(selected, total),
      },
      status_distribution: ALL_STATUSES.map((s) => ({
        status: s,
        label: DRIVE_STUDENT_STATUS_LABELS[s],
        count: c[s],
      })),
      breakdowns: {
        programme,
        gender,
        entry_type: entryType.map((r) => ({
          ...r,
          label: ENTRY_TYPE_LABELS[Number(r.label)] ?? r.label ?? '—',
        })),
        passout_year: passoutYear,
        cgpa_band: cgpaBand,
      },
      cgpa: {
        avg_pool: numOrNull(cgpaAvgRow.avg_pool),
        avg_selected: numOrNull(cgpaAvgRow.avg_selected),
      },
      response_time: {
        avg_hours:
          responseRow.avg_seconds === null
            ? null
            : Number(responseRow.avg_seconds) / 3600,
        buckets: [
          { label: '< 1 day', count: Number(responseRow.b1) },
          { label: '1 – 3 days', count: Number(responseRow.b2) },
          { label: '3 – 7 days', count: Number(responseRow.b3) },
          { label: '> 7 days', count: Number(responseRow.b4) },
        ],
      },
      reasons: { denied: deniedReasons, revoked: revokedReasons },
      attention: {
        not_invited: c[10],
        awaiting_response: c[20],
        stale_invites: Number(staleRow.count),
        awaiting_outcome: c[30],
      },
    };
  }

  // --- individual aggregates ------------------------------------------------

  private statusCounts(
    driveId: number,
  ): Promise<{ status: number; count: string }[]> {
    return this.members.query(
      `SELECT ds.status AS status, COUNT(*) AS count
         FROM drive_students ds
        WHERE ds.drive_id = $1
        GROUP BY ds.status`,
      [driveId],
    );
  }

  /**
   * A demographic breakdown grouped by `groupExpr` (a column or expression on
   * the `students s` alias). Every group reports its imported total, how many
   * ever accepted, and how many were selected. `NULL` group keys collapse to a
   * dash so the chart stays readable.
   */
  private async breakdown(
    driveId: number,
    groupExpr: string,
    extraJoin = '',
  ): Promise<BreakdownRow[]> {
    const rows: {
      label: string | null;
      imported: string;
      accepted: string;
      selected: string;
    }[] = await this.members.query(
      `SELECT ${groupExpr} AS label,
              COUNT(*) AS imported,
              COUNT(*) FILTER (WHERE ds.status IN (${ACCEPTED_OR_PAST.join(',')})) AS accepted,
              COUNT(*) FILTER (WHERE ds.status = ${DRIVE_STUDENT_STATUS.SELECTED}) AS selected
         FROM drive_students ds
         JOIN students s ON s.id = ds.student_id
         ${extraJoin}
        WHERE ds.drive_id = $1
        GROUP BY ${groupExpr}
        ORDER BY imported DESC`,
      [driveId],
    );
    return rows.map((r) => ({
      label: r.label === null || r.label === '' ? '—' : String(r.label),
      imported: Number(r.imported),
      accepted: Number(r.accepted),
      selected: Number(r.selected),
    }));
  }

  private async cgpaBands(driveId: number): Promise<CgpaBandRow[]> {
    const rows: {
      label: string;
      imported: string;
      selected: string;
      avg_cgpa: string | null;
    }[] = await this.members.query(
      `SELECT CASE
                WHEN s.ug_cgpa IS NULL THEN 'No CGPA'
                WHEN s.ug_cgpa < 6 THEN '< 6'
                WHEN s.ug_cgpa < 7 THEN '6 – 7'
                WHEN s.ug_cgpa < 8 THEN '7 – 8'
                WHEN s.ug_cgpa < 9 THEN '8 – 9'
                ELSE '9 – 10'
              END AS label,
              COUNT(*) AS imported,
              COUNT(*) FILTER (WHERE ds.status = ${DRIVE_STUDENT_STATUS.SELECTED}) AS selected,
              AVG(s.ug_cgpa) AS avg_cgpa
         FROM drive_students ds
         JOIN students s ON s.id = ds.student_id
        WHERE ds.drive_id = $1
        GROUP BY label`,
      [driveId],
    );
    return rows
      .map((r) => ({
        label: r.label,
        imported: Number(r.imported),
        selected: Number(r.selected),
        avg_cgpa: numOrNull(r.avg_cgpa),
      }))
      .sort(
        (a, b) =>
          CGPA_BAND_ORDER.indexOf(a.label) - CGPA_BAND_ORDER.indexOf(b.label),
      );
  }

  private async cgpaAverages(
    driveId: number,
  ): Promise<{ avg_pool: string | null; avg_selected: string | null }> {
    const [row] = await this.members.query(
      `SELECT AVG(s.ug_cgpa) AS avg_pool,
              AVG(s.ug_cgpa) FILTER (WHERE ds.status = ${DRIVE_STUDENT_STATUS.SELECTED}) AS avg_selected
         FROM drive_students ds
         JOIN students s ON s.id = ds.student_id
        WHERE ds.drive_id = $1`,
      [driveId],
    );
    return row ?? { avg_pool: null, avg_selected: null };
  }

  /** Time from invite → response, averaged and bucketed over responders. */
  private async responseTime(driveId: number): Promise<{
    avg_seconds: string | null;
    b1: string;
    b2: string;
    b3: string;
    b4: string;
  }> {
    const [row] = await this.members.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (responded_at - invited_at))) AS avg_seconds,
              COUNT(*) FILTER (WHERE responded_at - invited_at <  interval '1 day') AS b1,
              COUNT(*) FILTER (WHERE responded_at - invited_at >= interval '1 day'  AND responded_at - invited_at < interval '3 days') AS b2,
              COUNT(*) FILTER (WHERE responded_at - invited_at >= interval '3 days' AND responded_at - invited_at < interval '7 days') AS b3,
              COUNT(*) FILTER (WHERE responded_at - invited_at >= interval '7 days') AS b4
         FROM drive_students
        WHERE drive_id = $1 AND invited_at IS NOT NULL AND responded_at IS NOT NULL`,
      [driveId],
    );
    return row ?? { avg_seconds: null, b1: '0', b2: '0', b3: '0', b4: '0' };
  }

  private async staleInvites(driveId: number): Promise<{ count: string }> {
    const [row] = await this.members.query(
      `SELECT COUNT(*) AS count
         FROM drive_students
        WHERE drive_id = $1
          AND status = ${DRIVE_STUDENT_STATUS.INVITED}
          AND invited_at < now() - interval '${STALE_INVITE_DAYS} days'`,
      [driveId],
    );
    return row ?? { count: '0' };
  }

  private async reasons(driveId: number, status: number): Promise<ReasonRow[]> {
    const rows: { reason: string; count: string }[] = await this.members.query(
      `SELECT rejection_reason AS reason, COUNT(*) AS count
         FROM drive_students
        WHERE drive_id = $1 AND status = $2 AND rejection_reason IS NOT NULL
        GROUP BY rejection_reason
        ORDER BY count DESC
        LIMIT ${TOP_REASONS}`,
      [driveId, status],
    );
    return rows.map((r) => ({ reason: r.reason, count: Number(r.count) }));
  }

  private async assertDrive(driveId: number): Promise<void> {
    const exists = await this.drives.exists({ where: { id: driveId } });
    if (!exists) throw new NotFoundException('Drive not found.');
  }
}

/** Postgres AVG/numeric columns arrive as strings (or null) — coerce safely. */
function numOrNull(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
