import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GuardianRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export class GuardianRefreshDto extends createZodDto(GuardianRefreshSchema) {}
