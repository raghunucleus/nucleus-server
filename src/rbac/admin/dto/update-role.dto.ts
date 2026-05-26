import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: 'Code may only contain letters, digits, "_" and "-"',
    })
    .optional(),
  name: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(1024).nullable().optional(),
  role_type_keys: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(32)
    .optional(),
  // If supplied, fully replaces the role's screens.
  screens: z
    .array(
      z.object({
        screen_key: z.string().min(1).max(128),
        allowed_actions: z.array(z.string().min(1).max(32)).min(1).max(32),
        allowed_platforms: z
          .array(z.enum(['web', 'mobile']))
          .min(1)
          .max(2),
      }),
    )
    .min(1)
    .max(256)
    .optional(),
});

export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}
