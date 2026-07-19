import { z } from 'zod';

/** numeric(12,2) ceiling — matches the drive package columns. */
const MAX_AMOUNT = 9_999_999_999.99;

/** Optional money field: null/'' from the client mean "not provided". Without
 *  this, z.coerce.number() turns null into 0 and fails .positive(). */
const optionalAmount = z.preprocess(
  (v) => (v === null || v === '' ? undefined : v),
  z.coerce.number().positive().max(MAX_AMOUNT).optional(),
);

/**
 * The package recorded on a Selected drive-student. `ctc` / `stipend` are the
 * fixed value or the range MAX (the columns filters read); the `_min` fields
 * are only sent for a range and must sit below their main figure. Which of
 * CTC/stipend is required is decided by the effective offer type's flags — a
 * service concern (`assertSelection`), not the DTO's.
 */
export const SelectionPackageShape = {
  /** The designation (drive profile) the students were selected for. */
  drive_profile_id: z.coerce.number().int().positive(),
  /** CTC in LPA — fixed value or range max. */
  ctc: optionalAmount,
  /** CTC range lower bound; only with `ctc`, and below it. */
  ctc_min: optionalAmount,
  /** Stipend in ₹/month — fixed value or range max. */
  stipend: optionalAmount,
  /** Stipend range lower bound; only with `stipend`, and below it. */
  stipend_min: optionalAmount,
};

/** The `_min`-below-main and `_min`-requires-main rules, shared by both DTOs. */
export function refineSelectionPackage(
  v: {
    ctc?: number;
    ctc_min?: number;
    stipend?: number;
    stipend_min?: number;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.ctc_min != null) {
    if (v.ctc == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ctc_min'],
        message: 'A CTC lower bound needs the CTC itself.',
      });
    } else if (v.ctc_min >= v.ctc) {
      ctx.addIssue({
        code: 'custom',
        path: ['ctc_min'],
        message: 'The CTC lower bound must be below the CTC.',
      });
    }
  }
  if (v.stipend_min != null) {
    if (v.stipend == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['stipend_min'],
        message: 'A stipend lower bound needs the stipend itself.',
      });
    } else if (v.stipend_min >= v.stipend) {
      ctx.addIssue({
        code: 'custom',
        path: ['stipend_min'],
        message: 'The stipend lower bound must be below the stipend.',
      });
    }
  }
}

export interface SelectionPackageInput {
  drive_profile_id: number;
  ctc?: number | null;
  ctc_min?: number | null;
  stipend?: number | null;
  stipend_min?: number | null;
}
