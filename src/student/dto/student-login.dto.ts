import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StudentLoginSchema = z.object({
  // The roll number (students.student_id). Normalised to upper-case to match
  // how student records are stored.
  student_id: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((v) => v.toUpperCase()),
  // Accept any non-empty string here; the real strength policy is enforced
  // only when a password is *set*. Failing closed avoids leaking the policy.
  password: z.string().min(1).max(128),
});

export class StudentLoginDto extends createZodDto(StudentLoginSchema) {}
