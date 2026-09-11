import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ALL_INSIGHTS_SCREEN_KEYS } from '../insights-scope.service';

/** Longest query string a view may hold — a full scope + filters is ~300 chars. */
const MAX_SEARCH = 2000;

const name = z.string().trim().min(1).max(80);
/** Stored without the leading `?`, so the client can splice it into any URL. */
const search = z
  .string()
  .max(MAX_SEARCH)
  .transform((s) => s.replace(/^\?/, ''));

export const CreateSavedViewSchema = z
  .object({
    screen_key: z.string().refine((k) => ALL_INSIGHTS_SCREEN_KEYS.includes(k), {
      message: 'Not an insights screen',
    }),
    route: z.string().min(1).max(128),
    name,
    search: search.default(''),
    is_pinned: z.boolean().default(false),
  })
  .strict();
export class CreateSavedViewDto extends createZodDto(CreateSavedViewSchema) {}

export const UpdateSavedViewSchema = z
  .object({
    name: name.optional(),
    search: search.optional(),
    is_pinned: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nothing to update',
  });
export class UpdateSavedViewDto extends createZodDto(UpdateSavedViewSchema) {}
