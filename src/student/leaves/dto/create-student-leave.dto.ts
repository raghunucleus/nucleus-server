import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LEAVE_ATTACHMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export const LEAVE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const LEAVE_MAX_ATTACHMENTS = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** 'HH:MM' or 'HH:MM:SS', normalised to 'HH:MM:SS' for PG `time`. */
const clockTime = z
  .string()
  .regex(CLOCK_TIME, 'Use HH:MM')
  .transform((v) => (v.length === 5 ? `${v}:00` : v));

/** A real calendar date in 'YYYY-MM-DD' (rejects 2026-02-31 and the like). */
const isoDate = z
  .string()
  .regex(ISO_DATE, 'Use YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a valid date');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const LeaveAttachmentSchema = z
  .object({
    /** Object key returned by `POST /student/leaves/files`. */
    key: z.string().min(1).max(512),
    name: z.string().trim().min(1).max(255),
    mime: z.enum(LEAVE_ATTACHMENT_MIMES),
    size: z.number().int().positive().max(LEAVE_ATTACHMENT_MAX_BYTES),
  })
  .strict();

/**
 * Apply for leave (also the body of a resubmit). No date-window limits by
 * design — the client warns when the range falls outside the current
 * semester, the in-charge decides. Overlap with an existing open/approved
 * leave is rejected server-side (409).
 *
 * Omit `from_time`/`to_time` for a full-day leave. Supplying them makes it a
 * partial day, which is a single-date concept — the refinements below mirror
 * `CHK_student_leaves_partial_window` so a bad window is a 400, not a 500 from
 * the constraint.
 */
export const CreateStudentLeaveSchema = z
  .object({
    leave_type_id: z.number().int().positive(),
    from_date: isoDate,
    to_date: isoDate,
    from_time: clockTime.optional(),
    to_time: clockTime.optional(),
    reason: optionalText(1000),
    attachments: z
      .array(LeaveAttachmentSchema)
      .max(LEAVE_MAX_ATTACHMENTS, `At most ${LEAVE_MAX_ATTACHMENTS} files`)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to_date < v.from_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_date'],
        message: 'End date must be on or after the start date',
      });
    }
    const hasFrom = v.from_time !== undefined;
    const hasTo = v.to_time !== undefined;
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFrom ? 'to_time' : 'from_time'],
        message: 'Give both a start and an end time, or neither',
      });
    } else if (hasFrom && hasTo) {
      if (v.from_date !== v.to_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from_time'],
          message: 'A part-day leave must be on a single date',
        });
      }
      if (v.to_time! <= v.from_time!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['to_time'],
          message: 'End time must be after the start time',
        });
      }
    }
    const keys = new Set(v.attachments.map((a) => a.key));
    if (keys.size !== v.attachments.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'The same file was attached twice',
      });
    }
  });

export class CreateStudentLeaveDto extends createZodDto(
  CreateStudentLeaveSchema,
) {}
