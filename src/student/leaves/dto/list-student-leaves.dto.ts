import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { STUDENT_LEAVE_STATUSES } from '../../../leaves/entities/student-leave.entity';

export const ListStudentLeavesSchema = z
  .object({
    status: z.enum(STUDENT_LEAVE_STATUSES).optional(),
  })
  .strict();

export class ListStudentLeavesDto extends createZodDto(
  ListStudentLeavesSchema,
) {}
