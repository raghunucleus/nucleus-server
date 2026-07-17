import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const CancelSessionSchema = z
  .object({
    reason: z.string().trim().min(1).max(256),
  })
  .strict();

export const UncancelSessionSchema = z
  .object({
    reason: z.string().trim().max(256).optional(),
  })
  .strict();

export const SubstituteSessionSchema = z
  .object({
    new_effective_employee_id: z.coerce.number().int().positive(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict();

// Bulk cancel for a slot: cancel every cohort (and any regular row) that
// matches the supplied session ids in one transaction. The UI uses this to
// cancel "Open Elective 1 this Friday" without iterating per cohort.
export const BulkCancelSessionsSchema = z
  .object({
    session_ids: z.array(z.coerce.number().int().positive()).min(1).max(64),
    reason: z.string().trim().min(1).max(256),
  })
  .strict();

// Bulk substitute used when a single proctor covers an elective slot during
// an exam / event. The clash check ignores siblings inside this same call —
// otherwise the very first update would block all the rest.
export const BulkSubstituteSessionsSchema = z
  .object({
    session_ids: z.array(z.coerce.number().int().positive()).min(1).max(64),
    new_effective_employee_id: z.coerce.number().int().positive(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict();

export const MoveSessionSchema = z
  .object({
    new_timetable_period_id: z.coerce.number().int().positive().optional(),
    new_session_date: z.string().regex(DATE_RE).optional(),
    // Caller acknowledges a timing conflict and wants to schedule anyway.
    allow_conflict: z.coerce.boolean().optional(),
    // Caller acknowledges the target date is a holiday and wants to anyway.
    allow_holiday: z.coerce.boolean().optional(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.new_timetable_period_id !== undefined ||
      v.new_session_date !== undefined,
    { message: 'Pass new_timetable_period_id and/or new_session_date' },
  );

// Move several sessions to the same destination at once (atomic) — used to
// reschedule an elective slot's option children together.
export const MoveManySessionsSchema = z
  .object({
    session_ids: z.array(z.coerce.number().int().positive()).min(1).max(50),
    new_timetable_period_id: z.coerce.number().int().positive().optional(),
    new_session_date: z.string().regex(DATE_RE).optional(),
    allow_conflict: z.coerce.boolean().optional(),
    allow_holiday: z.coerce.boolean().optional(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.new_timetable_period_id !== undefined ||
      v.new_session_date !== undefined,
    { message: 'Pass new_timetable_period_id and/or new_session_date' },
  );

export const CreateAdHocSessionSchema = z
  .object({
    session_date: z.string().regex(DATE_RE),
    programme_semester_id: z.coerce.number().int().positive(),
    attendance_group_id: z.coerce.number().int().positive(),
    timetable_period_id: z.coerce.number().int().positive(),
    programme_semester_subject_id: z.coerce.number().int().positive(),
    programme_semester_subject_option_id: z.coerce
      .number()
      .int()
      .positive()
      .nullish(),
    scheduled_employee_id: z.coerce.number().int().positive(),
    room: z.string().trim().max(48).nullish(),
    note: z.string().trim().max(256).nullish(),
    // Caller acknowledges the date is a holiday and wants to add anyway.
    allow_holiday: z.coerce.boolean().optional(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict();

// In-place edit of a session's content (subject / teacher / room / note).
// Date + period are NOT here — those go through move. Every field is optional;
// at least one must be present so the call actually changes something.
export const EditSessionSchema = z
  .object({
    programme_semester_subject_id: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    programme_semester_subject_option_id: z.coerce
      .number()
      .int()
      .positive()
      .nullish(),
    scheduled_employee_id: z.coerce.number().int().positive().optional(),
    room: z.string().trim().max(48).nullish(),
    note: z.string().trim().max(256).nullish(),
    reason: z.string().trim().max(256).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.programme_semester_subject_id !== undefined ||
      v.scheduled_employee_id !== undefined ||
      v.room !== undefined ||
      v.note !== undefined,
    { message: 'Pass at least one field to change' },
  );

export const MarkAttendanceSchema = z
  .object({
    allow_amend: z.boolean().optional(),
    // Required when the admin records attendance on behalf of a teacher.
    // Stamped on every class_session_attendance row so the audit trail
    // credits the teacher, not the admin.
    on_behalf_of_employee_id: z.coerce.number().int().positive().optional(),
    entries: z
      .array(
        z
          .object({
            student_id: z.coerce.number().int().positive(),
            status: z.enum(['present', 'absent', 'late', 'exempt', 'od']),
          })
          .strict(),
      )
      .min(1)
      // Cross-group open electives (attendance_group_id = NULL on the session)
      // pull the whole batch's option pickers into one roster, which can run
      // into the low thousands. Cap high enough to never reject a legitimate
      // single-session roster while still rejecting obviously-bogus payloads.
      .max(5000),
  })
  .strict();

export class CancelSessionDto extends createZodDto(CancelSessionSchema) {}
export class UncancelSessionDto extends createZodDto(UncancelSessionSchema) {}
export class SubstituteSessionDto extends createZodDto(
  SubstituteSessionSchema,
) {}
export class BulkCancelSessionsDto extends createZodDto(
  BulkCancelSessionsSchema,
) {}
export class BulkSubstituteSessionsDto extends createZodDto(
  BulkSubstituteSessionsSchema,
) {}
export class MoveSessionDto extends createZodDto(MoveSessionSchema) {}
export class MoveManySessionsDto extends createZodDto(MoveManySessionsSchema) {}
export class EditSessionDto extends createZodDto(EditSessionSchema) {}
export class CreateAdHocSessionDto extends createZodDto(
  CreateAdHocSessionSchema,
) {}
export class MarkAttendanceDto extends createZodDto(MarkAttendanceSchema) {}
