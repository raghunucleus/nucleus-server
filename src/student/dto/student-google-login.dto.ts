import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StudentGoogleLoginSchema = z.object({
  // The Google-issued ID token (JWT) from the client-side sign-in.
  idToken: z.string().min(1),
});

export class StudentGoogleLoginDto extends createZodDto(
  StudentGoogleLoginSchema,
) {}
