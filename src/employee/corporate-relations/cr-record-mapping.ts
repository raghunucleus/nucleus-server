import { In, Repository } from 'typeorm';
import { CompanyJobRoleYear } from './entities/company-job-role-year.entity';
import { PassoutYear } from './entities/passout-year.entity';

/**
 * The (job role × passout year) record payload, shared by every surface that
 * renders one — CR View (self-scoped) and Management View (unscoped).
 *
 * Extracted for the same reason as {@link companyChromeFor}: both surfaces must
 * emit a BYTE-IDENTICAL `record` object, because the client types them as one
 * shape and the Management View row is literally a CR View row plus the CR. A
 * private copy per service is how those two silently drift.
 */

/**
 * The structural shape every lookup master these screens touch shares —
 * `CompanyLookupBase` and `DriveLookupBase` both satisfy it, which is what lets
 * one `sortedChips` serve the company masters and the Drive Attributes masters.
 */
export type LookupRow = {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export const yearOption = (y: PassoutYear) => ({
  id: y.id,
  passout_year: y.passout_year,
  display_year: y.display_year,
});

export const chip = (r: { id: number; name: string }) => ({
  id: r.id,
  name: r.name,
});

/** Relation arrays come back unordered; chips read in the master's order. */
export const sortedChips = (rows: LookupRow[] | undefined) =>
  [...(rows ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map(chip);

/**
 * The year's records for a set of job roles, keyed by job role id.
 *
 * `relationLoadStrategy: 'query'` is load-bearing: one query per relation
 * instead of one join with all five collections multiplied together — five
 * arrays in a single join is a cartesian product per record.
 */
export async function crRecordsFor(
  repo: Repository<CompanyJobRoleYear>,
  jobRoleIds: number[],
  passoutYearId: number,
): Promise<Map<number, CompanyJobRoleYear>> {
  if (jobRoleIds.length === 0) return new Map();
  const rows = await repo.find({
    where: {
      passout_year_id: passoutYearId,
      company_job_role_id: In(jobRoleIds),
    },
    relations: {
      relationship_types: true,
      current_status: true,
      designations: true,
      programmes: true,
      job_locations: true,
      contacts: true,
    },
    relationLoadStrategy: 'query',
  });
  return new Map(rows.map((x) => [x.company_job_role_id, x]));
}

/** `null` is the "nothing recorded for this year yet" signal the UI keys off. */
export function mapCrRecord(row: CompanyJobRoleYear | undefined) {
  return row
    ? {
        id: row.id,
        record_code: row.record_code,
        // Sorted here because TypeORM does not order a relation array, and the
        // chips should read in the master's configured order.
        relationship_types: sortedChips(row.relationship_types),
        // `null` means nothing chosen — the screen renders
        // `scope.default_status` in its place. Deliberately NOT resolved to the
        // default here: the two states look different on screen.
        current_status: row.current_status ? chip(row.current_status) : null,
        designations: sortedChips(row.designations),
        // Programmes have no sort_order and show their display name — the same
        // resolution `programmeOptions` uses for the picker.
        programmes: [...(row.programmes ?? [])]
          .map((p) => ({ id: p.id, name: p.display_name || p.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        job_locations: sortedChips(row.job_locations),
        contacts: [...(row.contacts ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
          .map((c) => ({
            id: c.id,
            hr_name: c.hr_name,
            hr_designation: c.hr_designation,
            hr_mobile: c.hr_mobile,
            hr_landline: c.hr_landline,
            hr_email: c.hr_email,
          })),
        next_follow_up_date: row.next_follow_up_date,
        remarks: row.remarks,
        updated_at: row.updated_at,
        updated_by_employee_id: row.updated_by_employee_id,
      }
    : null;
}
