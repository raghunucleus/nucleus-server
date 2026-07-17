import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { OPERATORS } from '../registry/types';

/**
 * Shared filter AST. Both input forms produce this shape: the structured
 * `filters` object is already in it, and an `nql` string compiles to it —
 * the engine only ever sees the AST. It is plain JSON on purpose so saved
 * filter presets can persist it verbatim later.
 */
export interface SearchCondition {
  attr: string;
  op: (typeof OPERATORS)[number];
  value?: unknown;
  /** For parameterized attributes (future: sgpa -> { semester: 3 }). */
  args?: Record<string, unknown>;
}

export interface SearchGroup {
  and?: SearchNode[];
  or?: SearchNode[];
}

export type SearchNode = SearchCondition | SearchGroup;

export function isGroupNode(node: SearchNode): node is SearchGroup {
  return (
    typeof node === 'object' &&
    node !== null &&
    ('and' in node || 'or' in node) &&
    !('attr' in node)
  );
}

export const MAX_FILTER_DEPTH = 5;
export const MAX_CONDITIONS = 50;
export const MAX_IN_VALUES = 100;
export const MAX_PAGE = 400;
export const MAX_PAGE_SIZE = 100;

const ConditionSchema = z.object({
  attr: z.string().min(1).max(64),
  op: z.enum(OPERATORS),
  value: z.unknown().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

type NodeInput = z.infer<typeof ConditionSchema> | { and?: NodeInput[]; or?: NodeInput[] };

const NodeSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z.union([ConditionSchema, GroupSchema]),
);

const GroupSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z
    .object({
      and: z.array(NodeSchema).min(1).optional(),
      or: z.array(NodeSchema).min(1).optional(),
    })
    .refine(
      (g) => (g.and !== undefined) !== (g.or !== undefined),
      'A filter group must have exactly one of "and" / "or".',
    ),
);

/** Structural depth/size guard — semantic checks live in the engine. */
function measure(node: NodeInput, depth: number, ctx: z.RefinementCtx, state: { conditions: number }): void {
  if (depth > MAX_FILTER_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      message: `Filter groups may nest at most ${MAX_FILTER_DEPTH} levels deep.`,
    });
    return;
  }
  if ('attr' in node && typeof node.attr === 'string') {
    state.conditions += 1;
    return;
  }
  const children = [...((node as { and?: NodeInput[] }).and ?? []), ...((node as { or?: NodeInput[] }).or ?? [])];
  for (const child of children) measure(child, depth + 1, ctx, state);
}

export const SORT_DIRS = ['asc', 'desc'] as const;
export const SEARCH_FORMATS = ['json', 'csv', 'xlsx'] as const;
export type SearchFormat = (typeof SEARCH_FORMATS)[number];

export const StudentSearchSchema = z
  .object({
    filters: GroupSchema.optional(),
    /** NQL text query — mutually exclusive with `filters`. */
    nql: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    columns: z.array(z.string().min(1).max(64)).max(40).optional(),
    search: z
      .string()
      .trim()
      .max(128)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    sort: z
      .object({
        by: z.string().min(1).max(64),
        dir: z.enum(SORT_DIRS).default('asc'),
      })
      .optional(),
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    skip_pagination: z.boolean().default(false),
    format: z.enum(SEARCH_FORMATS).default('json'),
  })
  .superRefine((body, ctx) => {
    if (body.filters && body.nql) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide either "filters" or "nql", not both.',
        path: ['nql'],
      });
    }
    if (body.filters) {
      const state = { conditions: 0 };
      measure(body.filters as NodeInput, 1, ctx, state);
      if (state.conditions > MAX_CONDITIONS) {
        ctx.addIssue({
          code: 'custom',
          message: `At most ${MAX_CONDITIONS} filter conditions are allowed.`,
          path: ['filters'],
        });
      }
    }
  });

export class StudentSearchDto extends createZodDto(StudentSearchSchema) {}

export interface StudentSearchResult {
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Resolved output column keys, in order (implicit columns first). */
  columns: string[];
}
