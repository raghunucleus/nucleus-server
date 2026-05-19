import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PROGRAMME_ADMISSION_YEARS_SORT_FIELDS = [
  'programme',
  'admission_year',
  'regulation',
  'status',
  'created_at',
  'updated_at',
] as const;

export type ProgrammeAdmissionYearsSortField =
  (typeof PROGRAMME_ADMISSION_YEARS_SORT_FIELDS)[number];

export const ListProgrammeAdmissionYearsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z
    .enum(PROGRAMME_ADMISSION_YEARS_SORT_FIELDS)
    .default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.enum(['active', 'inactive']).optional(),
  programmeId: z.coerce.number().int().positive().optional(),
  admissionYearId: z.coerce.number().int().positive().optional(),
  regulationId: z.coerce.number().int().positive().optional(),
});

export class ListProgrammeAdmissionYearsDto extends createZodDto(
  ListProgrammeAdmissionYearsSchema,
) {}
