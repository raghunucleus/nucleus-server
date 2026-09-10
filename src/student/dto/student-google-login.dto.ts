import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DeviceFieldsShape } from '../../auth-sessions/dto/device-fields.schema';

export const StudentGoogleLoginSchema = z.object({
  // The Google-issued ID token (JWT) from the client-side sign-in.
  idToken: z.string().min(1),
  ...DeviceFieldsShape,
});

export class StudentGoogleLoginDto extends createZodDto(
  StudentGoogleLoginSchema,
) {}
