import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { STUDENT_APPROVAL_STATUSES } from '../entities/student-approval.entity';

// The student's approvals list is small (their own inbox), so no pagination;
// optional narrowing by common status and by source module.
export const StudentListApprovalsSchema = z
  .object({
    status: z.enum(STUDENT_APPROVAL_STATUSES).optional(),
    module: z.string().max(32).optional(),
  })
  .strict();

export class StudentListApprovalsDto extends createZodDto(
  StudentListApprovalsSchema,
) {}
