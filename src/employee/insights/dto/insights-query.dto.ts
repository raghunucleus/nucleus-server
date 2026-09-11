import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?programme_ids=1,2,3` → `[1, 2, 3]`. Absent or empty → `undefined`, which
 * every consumer reads as "no narrowing — the full RBAC scope".
 */
const idList = z
  .union([z.string(), z.array(z.union([z.string(), z.number()]))])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    const parts = Array.isArray(v)
      ? v
      : v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
    const out: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected a comma-separated list of positive integers',
        });
        return z.NEVER;
      }
      out.push(n);
    }
    return out.length ? out : undefined;
  });

/**
 * The narrowing every insights read accepts. Each list can only NARROW the
 * caller's RBAC scope — `InsightsScopeService.resolve` intersects them with the
 * assignment's attributes, so an out-of-scope id simply drops out.
 */
export const scopeShape = {
  department_ids: idList,
  programme_ids: idList,
  admission_year_ids: idList,
  programme_admission_year_ids: idList,
  attendance_group_ids: idList,
};

export interface ScopeQuery {
  department_ids?: number[];
  programme_ids?: number[];
  admission_year_ids?: number[];
  programme_admission_year_ids?: number[];
  attendance_group_ids?: number[];
}

const bothOrNeither = (v: { from?: string; to?: string }) =>
  (v.from === undefined) === (v.to === undefined);
const BOTH_OR_NEITHER = {
  message: 'Pass both from and to, or neither',
  path: ['from'],
};
const ordered = (v: { from?: string; to?: string }) =>
  v.from === undefined || v.to === undefined || v.to >= v.from;
const ORDERED = { message: 'to must not be before from', path: ['to'] };

const dateShape = {
  from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
};

export const InsightsScopeQuerySchema = z.object(scopeShape).strict();
export class InsightsScopeQueryDto extends createZodDto(
  InsightsScopeQuerySchema,
) {}

/** Delta windows the overview offers — the last N days against the N before. */
export const OVERVIEW_WINDOWS = [7, 30, 90] as const;
export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number];

export const InsightsOverviewQuerySchema = z
  .object({
    ...scopeShape,
    window: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .default(30),
  })
  .strict();
export class InsightsOverviewQueryDto extends createZodDto(
  InsightsOverviewQuerySchema,
) {}

/** `GET /scope?screen=insights.attendance.view` — which screen's attributes to resolve. */
export const InsightsScopeTreeQuerySchema = z
  .object({ screen: z.string().min(1) })
  .strict();
export class InsightsScopeTreeQueryDto extends createZodDto(
  InsightsScopeTreeQuerySchema,
) {}

/**
 * Attendance reads: an optional semester NUMBER (1–8) picks that semester of
 * every batch in scope; omitted = each batch's ongoing semester. `from`/`to`
 * switch the basis exactly as on the incharge screen (both-or-neither).
 */
export const InsightsAttendanceQuerySchema = z
  .object({
    ...scopeShape,
    semester: z.coerce.number().int().min(1).max(8).optional(),
    ...dateShape,
  })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER)
  .refine(ordered, ORDERED);
export class InsightsAttendanceQueryDto extends createZodDto(
  InsightsAttendanceQuerySchema,
) {}

export const InsightsResultsQuerySchema = z
  .object({
    ...scopeShape,
    semester: z.coerce.number().int().min(1).max(8).optional(),
  })
  .strict();
export class InsightsResultsQueryDto extends createZodDto(
  InsightsResultsQuerySchema,
) {}

export const InsightsBacklogsQuerySchema = z
  .object({
    ...scopeShape,
    min_backlogs: z.coerce.number().int().min(1).max(50).default(1),
  })
  .strict();
export class InsightsBacklogsQueryDto extends createZodDto(
  InsightsBacklogsQuerySchema,
) {}

export const InsightsPlacementsQuerySchema = z
  .object({
    ...scopeShape,
    passout_years: idList,
  })
  .strict();
export class InsightsPlacementsQueryDto extends createZodDto(
  InsightsPlacementsQuerySchema,
) {}

/** Requests reads default to the last 90 days when no window is given. */
export const InsightsRequestsQuerySchema = z
  .object({ ...scopeShape, ...dateShape })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER)
  .refine(ordered, ORDERED);
export class InsightsRequestsQueryDto extends createZodDto(
  InsightsRequestsQuerySchema,
) {}
