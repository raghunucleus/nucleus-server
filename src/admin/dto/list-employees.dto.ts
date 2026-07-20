import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { GENDERS } from '../entities/employee.entity';

export const EMPLOYEES_SORT_FIELDS = [
  'emp_code',
  'emp_display_name',
  'gender',
  'mobile_number',
  'email',
  'rm_emp_code',
  'status',
  'created_at',
  'updated_at',
] as const;

export type EmployeesSortField = (typeof EMPLOYEES_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListEmployeesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(EMPLOYEES_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  // Single-box typeahead: OR-matched across emp_code / display name / email.
  // The per-column searches below stay for the employees table's column filters.
  q: optionalSearchString,
  empCodeSearch: optionalSearchString,
  displayNameSearch: optionalSearchString,
  emailSearch: optionalSearchString,
  mobileSearch: optionalSearchString,
  rmEmpCodeSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
  gender: z.enum(GENDERS).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  designationId: z.coerce.number().int().positive().optional(),
});

export class ListEmployeesDto extends createZodDto(ListEmployeesSchema) {}
