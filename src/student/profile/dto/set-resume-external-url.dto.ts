import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// https-only: the link is republished verbatim to recruiters from the
// student's profile — never allow plain http or exotic schemes.
export class SetResumeExternalUrlDto extends createZodDto(
  z
    .object({
      url: z
        .string()
        .trim()
        .max(512)
        .url()
        .refine((v) => v.startsWith('https://'), 'Enter an https:// link'),
    })
    .strict(),
) {}
