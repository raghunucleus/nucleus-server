import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BLOOD_GROUPS } from '../../../admin/entities/student.entity';

// The student-requestable profile fields. Value rules mirror the admin
// create-student DTO exactly — an approved request must never write a value an
// admin couldn't have entered. All optional, but at least one must be present;
// clearing a value (e.g. removing an ABC ID) is deliberately not supported —
// that stays an admin operation.
const ProfileUpdateChangesSchema = z
  .object({
    mobile_number: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')
      .optional(),
    email: z
      .string()
      .trim()
      .max(255)
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
    blood_group: z.enum(BLOOD_GROUPS).optional(),
    abc_id: z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'ABC ID must be exactly 12 digits')
      .optional(),
  })
  .strict()
  .refine(
    (changes) => Object.values(changes).some((v) => v !== undefined),
    'Provide at least one field to change',
  );

export const CreateProfileUpdateRequestSchema = z
  .object({
    changes: ProfileUpdateChangesSchema,
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .strict();

export class CreateProfileUpdateRequestDto extends createZodDto(
  CreateProfileUpdateRequestSchema,
) {}
