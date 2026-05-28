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
    reason: z.string().trim().max(256).optional(),
  })
  .strict();

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
export class SubstituteSessionDto extends createZodDto(SubstituteSessionSchema) {}
export class BulkCancelSessionsDto extends createZodDto(
  BulkCancelSessionsSchema,
) {}
export class BulkSubstituteSessionsDto extends createZodDto(
  BulkSubstituteSessionsSchema,
) {}
export class MoveSessionDto extends createZodDto(MoveSessionSchema) {}
export class CreateAdHocSessionDto extends createZodDto(
  CreateAdHocSessionSchema,
) {}
export class MarkAttendanceDto extends createZodDto(MarkAttendanceSchema) {}
