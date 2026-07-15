import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { INTERACTION_TYPES } from '../entities/company-interaction.entity';
import { MILESTONE_TYPES } from '../entities/company-relationship-milestone.entity';

const enumOf = (vals: readonly string[]) =>
  z.enum(vals as unknown as [string, ...string[]]);
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// --- SPOC contacts --------------------------------------------------------
export const ContactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  designation: z.string().trim().max(160).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable(),
  phone: z.string().trim().max(32).optional().nullable(),
  linkedin_url: z.string().trim().max(255).optional().nullable(),
  is_primary: z.coerce.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export class ContactDto extends createZodDto(ContactSchema) {}
export const UpdateContactSchema = ContactSchema.partial();
export class UpdateContactDto extends createZodDto(UpdateContactSchema) {}

// --- Interactions ---------------------------------------------------------
export const InteractionSchema = z.object({
  type: enumOf(INTERACTION_TYPES),
  interaction_date: dateStr,
  contact_id: z.coerce.number().int().positive().optional().nullable(),
  summary: z.string().trim().min(1).max(5000),
  follow_up_date: dateStr.optional().nullable(),
  outcome: z.string().trim().max(255).optional().nullable(),
});
export class InteractionDto extends createZodDto(InteractionSchema) {}
export const UpdateInteractionSchema = InteractionSchema.partial();
export class UpdateInteractionDto extends createZodDto(UpdateInteractionSchema) {}

/** Month/year filter for the interactions list (placement cycles recur yearly). */
export const InteractionQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export class InteractionQueryDto extends createZodDto(InteractionQuerySchema) {}

// --- Relationship milestones ----------------------------------------------
export const MilestoneSchema = z.object({
  milestone_date: dateStr,
  type: enumOf(MILESTONE_TYPES),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(5000).optional().nullable(),
});
export class MilestoneDto extends createZodDto(MilestoneSchema) {}
