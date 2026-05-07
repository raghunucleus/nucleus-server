import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RefreshSchema = z.object({
  refreshToken: z.jwt(),
});

export class RefreshDto extends createZodDto(RefreshSchema) {}
