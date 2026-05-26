import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EmployeeGoogleLoginSchema = z.object({
  // The Google-issued ID token (JWT) from the client-side sign-in.
  idToken: z.string().min(1),
});

export class EmployeeGoogleLoginDto extends createZodDto(
  EmployeeGoogleLoginSchema,
) {}
