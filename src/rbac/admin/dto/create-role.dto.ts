import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateRoleSchema = z.object({
  // Short identifier — alphanumerics plus `_` / `-`. Stays readable in URLs
  // and CSV exports; uniqueness is enforced case-insensitively server-side.
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: 'Code may only contain letters, digits, "_" and "-"',
    }),
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1024).nullable().optional(),
  // Catalog role type keys this role composes — validated against the
  // catalog server-side. At least one is required.
  role_type_keys: z.array(z.string().min(1).max(64)).min(1).max(32),
  // Per-screen action grant. The catalog validates the keys.
  screens: z
    .array(
      z.object({
        screen_key: z.string().min(1).max(128),
        allowed_actions: z.array(z.string().min(1).max(32)).min(1).max(32),
        // Subset of the catalog screen's platforms this role grants. At least
        // one platform must be selected — a screen with neither would never
        // render anywhere.
        allowed_platforms: z
          .array(z.enum(['web', 'mobile']))
          .min(1)
          .max(2),
      }),
    )
    .min(1)
    .max(256),
});

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}
