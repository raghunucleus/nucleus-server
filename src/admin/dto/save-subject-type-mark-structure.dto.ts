import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9._-]+$/, 'Use letters, numbers, dot, underscore, or dash'),
  );

const optionalName = z.string().trim().min(1).max(128).optional();

const ruleInputSchema = z
  .object({
    code: codeSchema,
    name: optionalName,
    max_marks: z.coerce.number().int().min(1).max(1000),
  })
  .strict();

// Discriminated union over rule.kind. zod's discriminatedUnion gives clean
// error messages and narrows TypeScript types based on `kind`.
const ruleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct') }).strict(),
  z
    .object({
      kind: z.literal('sum'),
      inputs: z.array(ruleInputSchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal('best_k_of_n'),
      k: z.coerce.number().int().min(1).max(20),
      inputs: z.array(ruleInputSchema).min(1).max(20),
    })
    .strict()
    .refine((v) => v.k <= v.inputs.length, {
      message: 'k cannot exceed the number of inputs',
      path: ['k'],
    }),
  z
    .object({
      kind: z.literal('rank_weighted'),
      weights: z.array(z.coerce.number().min(0).max(1)).min(1).max(20),
      inputs: z.array(ruleInputSchema).min(1).max(20),
    })
    .strict()
    .refine((v) => v.weights.length === v.inputs.length, {
      message: 'weights length must equal inputs length',
      path: ['weights'],
    })
    .refine(
      (v) => {
        const sum = v.weights.reduce((a, b) => a + b, 0);
        return Math.abs(sum - 1) < 1e-6;
      },
      { message: 'weights must sum to 1', path: ['weights'] },
    ),
]);

const codesUnique = <T extends { code: string }>(items: T[]): boolean => {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.code)) return false;
    seen.add(it.code);
  }
  return true;
};

const l2ItemSchema = z
  .object({
    code: codeSchema,
    name: optionalName,
    max_marks: z.coerce.number().int().min(1).max(1000),
    rule: ruleSchema,
  })
  .strict()
  .refine(
    (v) => v.rule.kind === 'direct' || codesUnique(v.rule.inputs),
    { message: 'Input codes within a rule must be unique', path: ['rule', 'inputs'] },
  );

const l1ComponentSchema = z
  .object({
    code: codeSchema,
    name: optionalName,
    max_marks: z.coerce.number().int().min(1).max(1000),
    // L2 items are optional — an empty list means the L1 is itself a leaf
    // (one direct mark from 0..max_marks). Only some subject types like THEORY
    // need a further breakdown.
    items: z.array(l2ItemSchema).max(20),
  })
  .strict()
  .refine((v) => codesUnique(v.items), {
    message: 'L2 item codes must be unique within an L1 component',
    path: ['items'],
  })
  .refine(
    (v) =>
      v.items.length === 0 ||
      v.items.reduce((s, it) => s + it.max_marks, 0) === v.max_marks,
    {
      message: 'Sum of L2 item max_marks must equal the L1 component max_marks',
      path: ['max_marks'],
    },
  );

export const SaveSubjectTypeMarkStructureSchema = z
  .object({
    max_marks: z.coerce.number().int().min(1).max(10000),
    components: z.array(l1ComponentSchema).min(1).max(20),
  })
  .strict()
  .refine((v) => codesUnique(v.components), {
    message: 'L1 component codes must be unique',
    path: ['components'],
  })
  .refine(
    (v) => v.components.reduce((s, c) => s + c.max_marks, 0) === v.max_marks,
    {
      message: 'Sum of L1 component max_marks must equal the total max_marks',
      path: ['max_marks'],
    },
  );

export class SaveSubjectTypeMarkStructureDto extends createZodDto(
  SaveSubjectTypeMarkStructureSchema,
) {}
