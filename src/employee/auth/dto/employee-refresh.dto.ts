import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EmployeeRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export class EmployeeRefreshDto extends createZodDto(EmployeeRefreshSchema) {}
