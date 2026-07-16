import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DIPLOMA_BOARDS_SORT_FIELDS = [
  'name',
  'code',
  'status',
  'created_at',
  'updated_at',
] as const;

export type DiplomaBoardsSortField =
  (typeof DIPLOMA_BOARDS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListDiplomaBoardsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(DIPLOMA_BOARDS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  nameSearch: optionalSearchString,
  codeSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
});

export class ListDiplomaBoardsDto extends createZodDto(
  ListDiplomaBoardsSchema,
) {}
