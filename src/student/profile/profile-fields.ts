import { z } from 'zod';
import {
  BLOOD_GROUPS,
  GENDERS,
  Student,
} from '../../admin/entities/student.entity';

/**
 * Single source of truth for the extended student profile: every field's wire
 * key, label, group, student edit policy, per-entry-type visibility and
 * mandatory-ness (completeness), backing column, and value schema. The request
 * DTO, the full-profile read API, and the admin update DTO are all derived
 * from this registry so the policy matrix lives in exactly one place.
 *
 * Edit policies (constrain the STUDENT only — admins edit everything directly):
 * - APPROVAL            student-editable via the profile_update approval request
 * - AUTO_REQUESTABLE    system-synced (marks), but a student change request is allowed
 * - OTP_VERIFY          student-editable, gated by email OTP (personal_email)
 * - NO_APPROVAL         student-editable, saved directly (resume)
 * - AUTO                system-computed, never student-editable
 * - SYSTEM_LOCKED       system-derived flag, never editable by the student
 * - EXISTING_READONLY   pre-existing value (college email), shown read-only
 * - ADMIN_ONLY          department/admin sets it; student sees it read-only
 */
export type FieldPolicy =
  | 'APPROVAL'
  | 'AUTO_REQUESTABLE'
  | 'OTP_VERIFY'
  | 'NO_APPROVAL'
  | 'AUTO'
  | 'SYSTEM_LOCKED'
  | 'EXISTING_READONLY'
  | 'ADMIN_ONLY';

/** Which entry types a rule applies to. 1 = Regular, 2 = Lateral. */
export type Applicability = 'both' | 'regular' | 'lateral' | 'none';

export function appliesTo(a: Applicability, entryType: number): boolean {
  if (a === 'both') return true;
  if (a === 'regular') return entryType === 1;
  if (a === 'lateral') return entryType === 2;
  return false;
}

export type ProfileGroupKey =
  | 'personal'
  | 'admission'
  | 'academic'
  | 'certifications'
  | 'parent'
  | 'address'
  | 'gov_ids'
  | 'entrance'
  | 'gap'
  | 'tenth'
  | 'twelfth'
  | 'diploma'
  | 'placement';

export const PROFILE_GROUPS: Array<{
  key: ProfileGroupKey;
  label: string;
  visible: Applicability;
  order: number;
}> = [
  { key: 'personal', label: 'Personal & identity', visible: 'both', order: 10 },
  {
    key: 'admission',
    label: 'Admission & programme',
    visible: 'both',
    order: 20,
  },
  {
    key: 'academic',
    label: 'Academic performance',
    visible: 'both',
    order: 30,
  },
  {
    key: 'certifications',
    label: 'Industry certifications',
    visible: 'both',
    order: 40,
  },
  { key: 'parent', label: 'Parent & guardian', visible: 'both', order: 50 },
  { key: 'address', label: 'Home address', visible: 'both', order: 60 },
  { key: 'gov_ids', label: 'Government IDs', visible: 'both', order: 70 },
  { key: 'entrance', label: 'Entrance exam', visible: 'both', order: 80 },
  { key: 'gap', label: 'Education gap', visible: 'both', order: 90 },
  {
    key: 'tenth',
    label: 'Education history — 10th',
    visible: 'both',
    order: 100,
  },
  {
    key: 'twelfth',
    label: 'Education history — 12th',
    visible: 'regular',
    order: 110,
  },
  {
    key: 'diploma',
    label: 'Education history — Diploma',
    visible: 'lateral',
    order: 120,
  },
  { key: 'placement', label: 'Placements', visible: 'both', order: 130 },
];

/** Lookup master tables the FK dropdown fields draw from. */
export type LookupTable =
  | 'countries'
  | 'states'
  | 'districts'
  | 'entrance_exams'
  | 'industry_certifications'
  | 'school_boards_x'
  | 'school_boards_xii'
  | 'diploma_boards';

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'date'
  | 'email'
  | 'phone'
  | 'number'
  | 'percentage'
  | 'cgpa'
  | 'year'
  | 'boolean'
  | 'enum'
  | 'fk';

export interface ProfileFieldDef {
  /** Wire key used in payloads, metadata, and client forms. */
  key: string;
  label: string;
  group: ProfileGroupKey;
  policy: FieldPolicy;
  /** Counts toward profile completeness for the matching entry type. */
  mandatory: Applicability;
  /** Shown to students of the matching entry type (admins always see it). */
  visible: Applicability;
  /**
   * Backing Student column when it differs from `key` or exists at all —
   * full_name aliases display_name, date_of_birth aliases dob, FK fields
   * point at their *_id column. Absent for derived values (admission_year)
   * and the repeatable certifications pseudo-field.
   */
  column?: keyof Student;
  kind: FieldKind;
  fk?: LookupTable;
  /**
   * Fields that submit + get decided as one atomic unit share a unit key
   * ('entrance_exam' | 'gap'); they never appear as standalone change items.
   */
  unit?: 'entrance_exam' | 'gap';
  /** Value schema for a single non-null value (shared with admin DTO rules). */
  schema?: z.ZodTypeAny;
}

const CURRENT_YEAR = new Date().getFullYear();

const name64 = z.string().trim().min(1).max(64);
const yearSchema = z.coerce
  .number()
  .int()
  .min(1950)
  .max(CURRENT_YEAR + 1);
const percentageSchema = z.coerce.number().min(0).max(100);
const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const emailSchema = z
  .string()
  .trim()
  .max(255)
  .email()
  .transform((v) => v.toLowerCase());
const fkIdSchema = z.coerce.number().int().positive();

export const PROFILE_FIELD_DEFS: ProfileFieldDef[] = [
  // --- Personal & identity ---------------------------------------------------
  {
    key: 'full_name',
    label: 'Full name (as per Aadhaar)',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'display_name',
    kind: 'text',
    schema: z.string().trim().min(1).max(128),
  },
  {
    key: 'first_name',
    label: 'First name',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: name64,
  },
  {
    key: 'middle_name',
    label: 'Middle name',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'text',
    schema: name64,
  },
  {
    key: 'last_name',
    label: 'Last name',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'text',
    schema: name64,
  },
  {
    key: 'gender',
    label: 'Gender',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'enum',
    schema: z.enum(GENDERS),
  },
  {
    key: 'date_of_birth',
    label: 'Date of birth',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'dob',
    kind: 'date',
    schema: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  },
  {
    key: 'mobile_number',
    label: 'Mobile number',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'phone',
    schema: mobileSchema,
  },
  {
    key: 'college_email',
    label: 'College email',
    group: 'personal',
    policy: 'EXISTING_READONLY',
    mandatory: 'both',
    visible: 'both',
    column: 'email',
    kind: 'email',
  },
  {
    key: 'personal_email',
    label: 'Personal email',
    group: 'personal',
    policy: 'OTP_VERIFY',
    mandatory: 'both',
    visible: 'both',
    kind: 'email',
    schema: emailSchema,
  },
  // Pre-existing requestable fields, kept so current behavior survives.
  {
    key: 'blood_group',
    label: 'Blood group',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'enum',
    schema: z.enum(BLOOD_GROUPS),
  },
  {
    key: 'abc_id',
    label: 'ABC ID',
    group: 'personal',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'ABC ID must be exactly 12 digits'),
  },

  // --- Admission & programme (system-derived) --------------------------------
  {
    key: 'admission_year',
    label: 'Admission year',
    group: 'admission',
    policy: 'AUTO',
    mandatory: 'both',
    visible: 'both',
    kind: 'year',
  },
  {
    key: 'pass_out_year',
    label: 'Pass-out year',
    group: 'admission',
    policy: 'AUTO',
    mandatory: 'both',
    visible: 'both',
    column: 'pass_out_year',
    kind: 'year',
  },

  // --- Academic performance ---------------------------------------------------
  {
    key: 'tenth_percentage',
    label: '10th mark (%)',
    group: 'academic',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'percentage',
    schema: percentageSchema,
  },
  {
    key: 'twelfth_percentage',
    label: '12th mark (%)',
    group: 'academic',
    policy: 'APPROVAL',
    mandatory: 'regular',
    visible: 'regular',
    kind: 'percentage',
    schema: percentageSchema,
  },
  {
    key: 'diploma_percentage',
    label: 'Diploma mark (%)',
    group: 'academic',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    kind: 'percentage',
    schema: percentageSchema,
  },
  {
    key: 'ug_cgpa',
    label: 'UG CGPA',
    group: 'academic',
    policy: 'AUTO_REQUESTABLE',
    mandatory: 'both',
    visible: 'both',
    kind: 'cgpa',
    schema: z.coerce.number().min(0).max(10),
  },
  {
    key: 'current_backlogs',
    label: 'Current backlogs',
    group: 'academic',
    policy: 'AUTO_REQUESTABLE',
    mandatory: 'both',
    visible: 'both',
    kind: 'number',
    schema: z.coerce.number().int().min(0).max(60),
  },
  {
    key: 'backlog_history',
    label: 'Backlog history',
    group: 'academic',
    policy: 'SYSTEM_LOCKED',
    mandatory: 'both',
    visible: 'both',
    kind: 'boolean',
  },
  {
    key: 'resume',
    label: 'Resume',
    group: 'academic',
    policy: 'NO_APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'resume_external_url',
    kind: 'text',
  },

  // --- Industry certifications (repeatable group; handled structurally) ------
  {
    key: 'industry_certifications',
    label: 'Industry certifications',
    group: 'certifications',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'fk',
    fk: 'industry_certifications',
  },

  // --- Parent & guardian ------------------------------------------------------
  {
    key: 'parent_name',
    label: 'Parent name',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: z.string().trim().min(1).max(128),
  },
  {
    key: 'parent_mobile',
    label: 'Parent mobile number',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'phone',
    schema: mobileSchema,
  },
  {
    key: 'parent_email',
    label: 'Parent email',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'email',
    schema: emailSchema,
  },
  {
    key: 'guardian_name',
    label: 'Guardian name',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: z.string().trim().min(1).max(128),
  },
  {
    key: 'guardian_mobile',
    label: 'Guardian mobile number',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'phone',
    schema: mobileSchema,
  },
  {
    key: 'guardian_email',
    label: 'Guardian email',
    group: 'parent',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'email',
    schema: emailSchema,
  },

  // --- Home address -----------------------------------------------------------
  {
    key: 'home_address',
    label: 'Home address',
    group: 'address',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'multiline',
    schema: z.string().trim().min(1).max(1000),
  },
  {
    key: 'home_district',
    label: 'Home district',
    group: 'address',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'home_district_id',
    kind: 'fk',
    fk: 'districts',
    schema: fkIdSchema,
  },
  {
    key: 'home_pincode',
    label: 'Home pincode',
    group: 'address',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
  },
  {
    key: 'home_state',
    label: 'Home state',
    group: 'address',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'home_state_id',
    kind: 'fk',
    fk: 'states',
    schema: fkIdSchema,
  },
  {
    key: 'home_country',
    label: 'Home country',
    group: 'address',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'home_country_id',
    kind: 'fk',
    fk: 'countries',
    schema: fkIdSchema,
  },

  // --- Government IDs ----------------------------------------------------------
  {
    key: 'aadhaar_number',
    label: 'Aadhaar number',
    group: 'gov_ids',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
  },
  {
    key: 'pan_number',
    label: 'PAN number',
    group: 'gov_ids',
    policy: 'APPROVAL',
    mandatory: 'none',
    visible: 'both',
    kind: 'text',
    schema: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (AAAAA9999A)'),
      ),
  },

  // --- Entrance exam (atomic unit) ---------------------------------------------
  {
    key: 'entrance_exam_rank',
    label: 'Entrance exam rank',
    group: 'entrance',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'number',
    unit: 'entrance_exam',
    schema: z.coerce.number().int().positive(),
  },
  {
    key: 'entrance_exam',
    label: 'Entrance exam',
    group: 'entrance',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'entrance_exam_id',
    kind: 'fk',
    fk: 'entrance_exams',
    unit: 'entrance_exam',
    schema: fkIdSchema,
  },
  {
    key: 'entrance_exam_year',
    label: 'Entrance exam year',
    group: 'entrance',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'year',
    unit: 'entrance_exam',
    schema: z.coerce.number().int().min(1950).max(CURRENT_YEAR),
  },

  // --- Education gap (atomic unit) ----------------------------------------------
  {
    key: 'year_of_gap',
    label: 'Years of gap',
    group: 'gap',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'number',
    unit: 'gap',
    schema: z.coerce.number().int().min(0).max(10),
  },
  {
    key: 'reason_of_gap',
    label: 'Reason of gap',
    group: 'gap',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'multiline',
    unit: 'gap',
    schema: z.string().trim().min(1).max(1000),
  },

  // --- Education history: 10th ---------------------------------------------------
  {
    key: 'tenth_board',
    label: '10th board',
    group: 'tenth',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'tenth_board_id',
    kind: 'fk',
    fk: 'school_boards_x',
    schema: fkIdSchema,
  },
  {
    key: 'tenth_institution',
    label: '10th institution',
    group: 'tenth',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'text',
    schema: z.string().trim().min(1).max(255),
  },
  {
    key: 'tenth_year_of_pass',
    label: '10th year of pass',
    group: 'tenth',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'year',
    schema: yearSchema,
  },
  {
    key: 'tenth_state',
    label: '10th state',
    group: 'tenth',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    column: 'tenth_state_id',
    kind: 'fk',
    fk: 'states',
    schema: fkIdSchema,
  },

  // --- Education history: 12th (Regular only) --------------------------------------
  {
    key: 'twelfth_board',
    label: '12th board of study',
    group: 'twelfth',
    policy: 'APPROVAL',
    mandatory: 'regular',
    visible: 'regular',
    column: 'twelfth_board_id',
    kind: 'fk',
    fk: 'school_boards_xii',
    schema: fkIdSchema,
  },
  {
    key: 'twelfth_institution',
    label: '12th institution',
    group: 'twelfth',
    policy: 'APPROVAL',
    mandatory: 'regular',
    visible: 'regular',
    kind: 'text',
    schema: z.string().trim().min(1).max(255),
  },
  {
    key: 'twelfth_year_of_pass',
    label: '12th year of pass',
    group: 'twelfth',
    policy: 'APPROVAL',
    mandatory: 'regular',
    visible: 'regular',
    kind: 'year',
    schema: yearSchema,
  },
  {
    key: 'twelfth_state',
    label: '12th state',
    group: 'twelfth',
    policy: 'APPROVAL',
    mandatory: 'regular',
    visible: 'regular',
    column: 'twelfth_state_id',
    kind: 'fk',
    fk: 'states',
    schema: fkIdSchema,
  },

  // --- Education history: Diploma (Lateral only) --------------------------------------
  {
    key: 'diploma_board',
    label: 'Diploma board',
    group: 'diploma',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    column: 'diploma_board_id',
    kind: 'fk',
    fk: 'diploma_boards',
    schema: fkIdSchema,
  },
  {
    key: 'diploma_institution',
    label: 'Diploma institution',
    group: 'diploma',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    kind: 'text',
    schema: z.string().trim().min(1).max(255),
  },
  {
    key: 'diploma_year_of_pass',
    label: 'Diploma year of pass',
    group: 'diploma',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    kind: 'year',
    schema: yearSchema,
  },
  {
    key: 'diploma_specialization',
    label: 'Diploma specialization',
    group: 'diploma',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    kind: 'text',
    schema: z.string().trim().min(1).max(128),
  },
  {
    key: 'diploma_state',
    label: 'Diploma state',
    group: 'diploma',
    policy: 'APPROVAL',
    mandatory: 'lateral',
    visible: 'lateral',
    column: 'diploma_state_id',
    kind: 'fk',
    fk: 'states',
    schema: fkIdSchema,
  },

  // --- Placements -------------------------------------------------------------------
  {
    key: 'allowed_by_dept_for_placements',
    label: 'Allowed by department for placements',
    group: 'placement',
    policy: 'ADMIN_ONLY',
    mandatory: 'none',
    visible: 'both',
    kind: 'boolean',
  },
  {
    key: 'interested_in_placements_self',
    label: 'Interested in placements',
    group: 'placement',
    policy: 'APPROVAL',
    mandatory: 'both',
    visible: 'both',
    kind: 'boolean',
    schema: z.boolean(),
  },
];

export const PROFILE_FIELD_BY_KEY: ReadonlyMap<string, ProfileFieldDef> =
  new Map(PROFILE_FIELD_DEFS.map((d) => [d.key, d]));

/** Backing Student column of a def (defaults to the key itself). */
export function columnOf(def: ProfileFieldDef): keyof Student | null {
  if (def.column) return def.column;
  if (def.key === 'admission_year' || def.key === 'industry_certifications') {
    return null; // derived / relational — no scalar column
  }
  return def.key as keyof Student;
}

/**
 * Simple (non-unit, non-repeatable) fields a student of this entry type may
 * put in an approval request. Units (entrance exam, gap) and certifications
 * are requested through their composite payload shapes instead.
 */
export function requestableSimpleFieldsFor(
  entryType: number,
): ProfileFieldDef[] {
  return PROFILE_FIELD_DEFS.filter(
    (d) =>
      (d.policy === 'APPROVAL' || d.policy === 'AUTO_REQUESTABLE') &&
      !d.unit &&
      d.key !== 'industry_certifications' &&
      appliesTo(d.visible, entryType),
  );
}

/** Canonical labels for every wire key, including the composite unit keys. */
export const PROFILE_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(PROFILE_FIELD_DEFS.map((d) => [d.key, d.label])),
  entrance_exam: 'Entrance exam',
  gap: 'Education gap',
  // Legacy key from the original 4-field request flow.
  email: 'Email',
};
