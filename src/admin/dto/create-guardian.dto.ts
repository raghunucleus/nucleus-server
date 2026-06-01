import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { GUARDIAN_RELATIONSHIPS } from '../../guardian/entities/student-guardian.entity';

const emailSchema = z
  .union([z.string().trim().max(255).email(), z.literal(''), z.null()])
  .optional()
  .transform((v): string | null =>
    v === undefined || v === null || v === '' ? null : v.toLowerCase(),
  );

// Create one guardian contact for a student. Guardians are per-student, so a
// contact always belongs to a specific student and relationship.
export const CreateGuardianSchema = z
  .object({
    student_id: z.coerce.number().int().positive(),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS),
    name: z.string().trim().min(1).max(128),
    mobile_number: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    email: emailSchema,
    is_primary: z.coerce.boolean().optional(),
  })
  .strict();

export class CreateGuardianDto extends createZodDto(CreateGuardianSchema) {}
