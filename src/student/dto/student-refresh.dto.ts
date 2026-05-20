import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StudentRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export class StudentRefreshDto extends createZodDto(StudentRefreshSchema) {}
