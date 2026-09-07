import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every analytics read is pinned to one owned attendance group and one
 * programme semester of that group's batch. `from`/`to` are BOTH-OR-NEITHER:
 *
 *   - omitted  → "whole semester", answered from the `student_subject_attendance`
 *                rollup so the numbers are identical to the student's own
 *                dashboard by construction (`basis: 'rollup'`).
 *   - supplied → a live scan of the marked sessions in that window
 *                (`basis: 'sessions'`), which cannot fold in
 *                `attendance_adjustments` because a delta carries an
 *                effective_date but no session to attribute it to.
 *
 * See AttendanceAnalyticsService for why the two modes exist rather than one
 * query doing both.
 */
const baseShape = {
  group_id: z.coerce.number().int().positive(),
  programme_semester_id: z.coerce.number().int().positive(),
  from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
};

/** Both-or-neither, and ordered. Applied identically to each schema below —
 *  zod's `.refine` narrows the output type, so this is spelled out per schema
 *  rather than wrapped in a generic helper. */
const bothOrNeither = (v: { from?: string; to?: string }) =>
  (v.from === undefined) === (v.to === undefined);
const BOTH_OR_NEITHER = {
  message: 'Pass both from and to, or neither',
  path: ['from'],
};
const ordered = (v: { from?: string; to?: string }) =>
  v.from === undefined || v.to === undefined || v.to >= v.from;
const ORDERED = {
  message: 'to must not be before from',
  path: ['to'],
};

export const AnalyticsScopeQuerySchema = z
  .object(baseShape)
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER)
  .refine(ordered, ORDERED);
export class AnalyticsScopeQueryDto extends createZodDto(
  AnalyticsScopeQuerySchema,
) {}

/** `/daily` — the date × student matrix is opt-in and range-capped, because it
 *  is the only payload that grows as students × days. */
export const AnalyticsDailyQuerySchema = z
  .object({
    ...baseShape,
    // Query strings arrive as text; `z.coerce.boolean()` would make the string
    // 'false' truthy, so match the literal instead.
    matrix: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER)
  .refine(ordered, ORDERED);
export class AnalyticsDailyQueryDto extends createZodDto(
  AnalyticsDailyQuerySchema,
) {}

/** `/sessions` — extra filters for the session log. */
export const AnalyticsSessionsQuerySchema = z
  .object({
    ...baseShape,
    subject_id: z.coerce.number().int().positive().optional(),
    state: z
      .enum(['all', 'marked', 'overdue_unmarked', 'upcoming', 'cancelled'])
      .optional(),
  })
  .strict()
  .refine(bothOrNeither, BOTH_OR_NEITHER)
  .refine(ordered, ORDERED);
export class AnalyticsSessionsQueryDto extends createZodDto(
  AnalyticsSessionsQuerySchema,
) {}
