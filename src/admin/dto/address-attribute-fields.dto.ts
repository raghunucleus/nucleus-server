import { z } from 'zod';

// Shared field shapes for the address master DTOs (country / state / district).
//
// Every government identifier here is optional: an admin may add a country or
// district before looking its codes up, and non-India rows have no LGD code at
// all. The seeded India data populates all of them, but the schema does not
// require that.
//
// Same normalise-then-validate contract as optionalText in
// create-industry-certification.dto.ts: empty string -> null, so `null` clears
// the column and an absent key leaves it untouched. Validation only runs once a
// value has survived as a non-empty string — a blank box on an optional field
// must never be an error.
function optionalCode(opts: {
  max: number;
  label: string;
  pattern: RegExp;
  message: string;
  uppercase?: boolean;
}) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : v))
    .transform((v) =>
      typeof v === 'string' && opts.uppercase ? v.toUpperCase() : v,
    )
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (typeof v !== 'string') return;
      if (v.length > opts.max) {
        ctx.addIssue({
          code: 'custom',
          message: `${opts.label} must be at most ${opts.max} characters`,
        });
        return;
      }
      if (!opts.pattern.test(v)) {
        ctx.addIssue({ code: 'custom', message: opts.message });
      }
    });
}

export const optionalIso2 = optionalCode({
  max: 2,
  label: 'ISO alpha-2 code',
  pattern: /^[A-Z]{2}$/,
  message: 'ISO alpha-2 code must be exactly 2 letters, e.g. IN',
  uppercase: true,
});

export const optionalIso3 = optionalCode({
  max: 3,
  label: 'ISO alpha-3 code',
  pattern: /^[A-Z]{3}$/,
  message: 'ISO alpha-3 code must be exactly 3 letters, e.g. IND',
  uppercase: true,
});

export const optionalDialCode = optionalCode({
  max: 8,
  label: 'Dial code',
  pattern: /^\+[0-9]{1,6}$/,
  message: 'Dial code must start with + followed by digits, e.g. +91',
});

// LGD codes are identifiers, not quantities — kept as strings so any leading
// zeros in a future export survive.
export const optionalLgdCode = optionalCode({
  max: 16,
  label: 'LGD code',
  pattern: /^[0-9]{1,16}$/,
  message: 'LGD code must be digits only',
});

// ISO 3166-2 subdivision code, e.g. IN-AP. The country prefix is part of the
// code, which is why it is globally unique rather than scoped per country.
export const optionalStateIsoCode = optionalCode({
  max: 8,
  label: 'ISO code',
  pattern: /^[A-Z]{2}-[A-Z0-9]{1,4}$/,
  message: 'ISO code must look like IN-AP',
  uppercase: true,
});

// Shared list-filter primitive, matching list-industry-certifications.dto.ts.
export const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

// `status` filters on the row's OWN is_active. `effectiveActive` filters on the
// whole ancestor chain (district -> state -> country) and is what any consumer
// picker should use; see DistrictsService.applyEffectiveActive. They answer
// different questions, so both exist — if both are sent, effectiveActive wins.
export const optionalEffectiveActive = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const optionalParentId = z.coerce.number().int().positive().optional();
