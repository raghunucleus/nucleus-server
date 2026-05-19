import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BLOOD_GROUPS, GENDERS } from '../entities/student.entity';

export const STUDENTS_SORT_FIELDS = [
  'student_id',
  'display_name',
  'gender',
  'mobile_number',
  'email',
  'abc_id',
  'dob',
  'status',
  'created_at',
  'updated_at',
] as const;

export type StudentsSortField = (typeof STUDENTS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListStudentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(STUDENTS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  studentIdSearch: optionalSearchString,
  displayNameSearch: optionalSearchString,
  emailSearch: optionalSearchString,
  mobileSearch: optionalSearchString,
  abcIdSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
  gender: z.enum(GENDERS).optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  programmeId: z.coerce.number().int().positive().optional(),
  admissionYearId: z.coerce.number().int().positive().optional(),
});

export class ListStudentsDto extends createZodDto(ListStudentsSchema) {}
