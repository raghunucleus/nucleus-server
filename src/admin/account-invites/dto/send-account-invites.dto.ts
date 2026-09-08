import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const studentFilter = z.object({
  programme_id: z.coerce.number().int().positive(),
  admission_year_id: z.coerce.number().int().positive(),
});

const employeeFilter = z.object({
  department_id: z.coerce.number().int().positive(),
});

/**
 * One endpoint covers all three admin gestures: a single row is
 * `subject_ids: [id]`, a multi-select is a longer list, and a whole batch is
 * `filter`. Splitting them would triple the surface for no behavioural gain.
 *
 * The 200-id cap is a client-side chunking boundary, not the real limit —
 * `ACCOUNT_INVITE_MAX_BATCH` governs that. It exists because a single request
 * sending more than ~200 emails can brush nginx's default 60s
 * `proxy_read_timeout`, which would show the admin a network error while the
 * server kept sending, and make a retry double-send.
 */
export const SendAccountInvitesSchema = z
  .object({
    subject_type: z.enum(['employee', 'student']),
    subject_ids: z
      .array(z.coerce.number().int().positive())
      .min(1)
      .max(200)
      .optional(),
    filter: z.union([studentFilter, employeeFilter]).optional(),
    /** Batch mode: skip people whose account already works. */
    only_uninvited: z.boolean().default(true),
    /** When false, someone holding a live invite is skipped rather than re-mailed. */
    resend: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const provided = (v.subject_ids ? 1 : 0) + (v.filter ? 1 : 0);
    if (provided !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of subject_ids or filter.',
      });
      return;
    }
    if (!v.filter) return;
    if (v.subject_type === 'student' && !('programme_id' in v.filter)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filter'],
        message: 'Student batches need programme_id and admission_year_id.',
      });
    }
    if (v.subject_type === 'employee' && !('department_id' in v.filter)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filter'],
        message: 'Employee batches need department_id.',
      });
    }
  });

export class SendAccountInvitesDto extends createZodDto(
  SendAccountInvitesSchema,
) {}

export const RevokeAccountInviteSchema = z.object({
  subject_type: z.enum(['employee', 'student']),
  subject_id: z.coerce.number().int().positive(),
});

export class RevokeAccountInviteDto extends createZodDto(
  RevokeAccountInviteSchema,
) {}

export const PreviewAccountInvitesSchema = z
  .object({
    subject_type: z.enum(['employee', 'student']),
    programme_id: z.coerce.number().int().positive().optional(),
    admission_year_id: z.coerce.number().int().positive().optional(),
    department_id: z.coerce.number().int().positive().optional(),
    only_uninvited: z.coerce.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (
      v.subject_type === 'student' &&
      !(v.programme_id && v.admission_year_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Student batches need programme_id and admission_year_id.',
      });
    }
    if (v.subject_type === 'employee' && !v.department_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Employee batches need department_id.',
      });
    }
  });

export class PreviewAccountInvitesDto extends createZodDto(
  PreviewAccountInvitesSchema,
) {}

export const ListAccountInvitesSchema = z.object({
  subject_type: z.enum(['employee', 'student']),
  subject_id: z.coerce.number().int().positive(),
});

export class ListAccountInvitesDto extends createZodDto(
  ListAccountInvitesSchema,
) {}
