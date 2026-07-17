import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  APPROVAL_REQUEST_STATUSES,
  APPROVAL_REQUEST_TYPES,
} from '../entities/approval-request.entity';

// Student "My Requests" — the list is small (a student's own requests), so no
// pagination; optional narrowing by status/type.
export const StudentListRequestsSchema = z
  .object({
    status: z.enum(APPROVAL_REQUEST_STATUSES).optional(),
    type: z.enum(APPROVAL_REQUEST_TYPES).optional(),
  })
  .strict();

export class StudentListRequestsDto extends createZodDto(
  StudentListRequestsSchema,
) {}

// Employee Approvals inbox — defaults to the actionable slice (pending) and
// paginates; 'all' lifts the status filter.
const APPROVAL_STATUS_FILTERS = [...APPROVAL_REQUEST_STATUSES, 'all'] as const;

export const EmployeeListApprovalsSchema = z
  .object({
    status: z.enum(APPROVAL_STATUS_FILTERS).default('pending'),
    type: z.enum(APPROVAL_REQUEST_TYPES).optional(),
    // Inclusive local-date window on created_at (YYYY-MM-DD). The `to` day
    // counts to its end — the service treats it as `< to + 1 day`.
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export class EmployeeListApprovalsDto extends createZodDto(
  EmployeeListApprovalsSchema,
) {}
