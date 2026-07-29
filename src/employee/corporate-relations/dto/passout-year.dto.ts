import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create/edit one passout year.
 *
 * `display_year` is deliberately absent — it is always derived from
 * `passout_year` server-side. The dates are optional: omitting one means "use
 * the default window for this year", which is also what makes a year change
 * carry its untouched dates along.
 */
export const PassoutYearSchema = z.object({
  passout_year: z.coerce.number().int().gt(2000).lt(2100),
  start_date: z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD.').optional(),
  end_date: z.string().regex(ISO_DATE, 'Expected YYYY-MM-DD.').optional(),
});
export class PassoutYearDto extends createZodDto(PassoutYearSchema) {}

/**
 * An edit moves the academic window only — the year is fixed once the row
 * exists, so it is deliberately absent here rather than merely ignored.
 */
export const UpdatePassoutYearSchema = PassoutYearSchema.omit({
  passout_year: true,
}).partial();
export class UpdatePassoutYearDto extends createZodDto(
  UpdatePassoutYearSchema,
) {}
