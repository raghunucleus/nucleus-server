import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Filters for the Roles or Designations list.
 *
 * There is no pagination here on purpose: the list is already bounded to the
 * job roles the caller is personally accountable for — tens of rows, not
 * thousands — and the screen groups them by company. Paging would slice a
 * company's roles across two pages and make the grouped view lie.
 *
 * `search` is an optional server-side pre-filter over both the company name and
 * the role name; the screen also filters/sorts what it has client-side.
 */
export const MyJobRoleListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
export class MyJobRoleListQueryDto extends createZodDto(
  MyJobRoleListQuerySchema,
) {}
