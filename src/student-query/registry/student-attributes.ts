import {
  BLOOD_GROUPS,
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  GENDERS,
} from '../../admin/entities/student.entity';
import { JOINS } from './joins';
import {
  AttrKind,
  AttributeDef,
  AttributeGroupDef,
  DEFAULT_OPERATORS,
  FK_LOOKUPS,
  FilterFacet,
  JoinId,
  Operator,
  isHydrateFacet,
  isSqlFacet,
} from './types';

export const ATTRIBUTE_GROUPS: readonly AttributeGroupDef[] = [
  { key: 'identity', label: 'Identity' },
  { key: 'admission', label: 'Admission & batch' },
  { key: 'academic', label: 'Academic performance' },
  { key: 'certifications', label: 'Certifications' },
  { key: 'placement', label: 'Placement' },
  { key: 'parent', label: 'Parent & guardian' },
  { key: 'address', label: 'Address' },
  { key: 'entrance', label: 'Entrance exam' },
  { key: 'tenth', label: '10th' },
  { key: 'twelfth', label: '12th' },
  { key: 'diploma', label: 'Diploma' },
  { key: 'gov_ids', label: 'Government IDs' },
  { key: 'system', label: 'System' },
];

/** Flat `students` column usable for filter, select, and sort. */
function col(
  key: string,
  label: string,
  group: string,
  kind: AttrKind,
  extra: Partial<AttributeDef> = {},
): AttributeDef {
  const expr = `s.${key}`;
  return {
    key,
    label,
    group,
    kind,
    filter: { expr },
    select: { expr },
    sort: { expr },
    ...extra,
  };
}

/** FK attr: join-free filter on the local `s.<key>_id`, joined label for
 *  select/sort. `column` overrides the local column when it differs from
 *  `<key>_id`. */
function fk(
  key: string,
  label: string,
  group: string,
  lookup: keyof typeof FK_LOOKUPS,
  join: JoinId,
  labelExpr: string,
  extra: Partial<AttributeDef> & { column?: string } = {},
): AttributeDef {
  const { column, ...rest } = extra;
  return {
    key,
    label,
    group,
    kind: 'fk',
    fkLookup: lookup,
    filter: { expr: `s.${column ?? `${key}_id`}` },
    select: { expr: labelExpr, joins: [join] },
    sort: { expr: labelExpr, joins: [join] },
    ...rest,
  };
}

export const STUDENT_ATTRIBUTES: readonly AttributeDef[] = [
  // --- identity -----------------------------------------------------------
  col('student_id', 'Roll number', 'identity', 'string', { searchable: true }),
  col('display_name', 'Full name', 'identity', 'string', { searchable: true }),
  col('first_name', 'First name', 'identity', 'string'),
  col('middle_name', 'Middle name', 'identity', 'string'),
  col('last_name', 'Last name', 'identity', 'string'),
  col('gender', 'Gender', 'identity', 'enum', {
    enumValues: GENDERS,
    enumLabels: { male: 'Male', female: 'Female', other: 'Other' },
  }),
  col('dob', 'Date of birth', 'identity', 'date'),
  col('blood_group', 'Blood group', 'identity', 'enum', {
    enumValues: BLOOD_GROUPS,
  }),
  col('abc_id', 'ABC ID', 'identity', 'string'),
  col('email', 'College email', 'identity', 'string', { searchable: true }),
  col('personal_email', 'Personal email', 'identity', 'string'),
  col('mobile_number', 'Mobile number', 'identity', 'string', {
    searchable: true,
  }),

  // --- admission & batch --------------------------------------------------
  fk('programme', 'Programme', 'admission', 'programmes', 'programme',
    'programme.name', { column: 'programme_id' }),
  {
    // One FK hop behind programme — join-free filter via IN-subquery.
    key: 'department',
    label: 'Department',
    group: 'admission',
    kind: 'fk',
    fkLookup: 'departments',
    operators: ['eq', 'neq', 'in', 'not_in'],
    filter: {
      subquery: {
        local: 's.programme_id',
        table: 'programmes',
        alias: 'dep_p',
        select: 'dep_p.id',
        valueExpr: 'dep_p.department_id',
      },
    },
    select: { expr: 'department.name', joins: ['department'] },
    sort: { expr: 'department.name', joins: ['department'] },
  },
  {
    key: 'degree',
    label: 'Degree',
    group: 'admission',
    kind: 'fk',
    fkLookup: 'degrees',
    operators: ['eq', 'neq', 'in', 'not_in'],
    filter: {
      subquery: {
        local: 's.programme_id',
        table: 'programmes',
        alias: 'deg_p',
        select: 'deg_p.id',
        valueExpr: 'deg_p.degree_id',
      },
    },
    select: { expr: 'degree.name', joins: ['degree'] },
    sort: { expr: 'degree.name', joins: ['degree'] },
  },
  fk('admission_year', 'Admission year', 'admission', 'admission_years',
    'admission_year', 'admission_year.display_year', {
      column: 'admission_year_id',
    }),
  {
    // Section membership lives on student_groups (UNIQUE per student) —
    // filtered with an EXISTS probe so the main query stays join-free.
    key: 'attendance_group',
    label: 'Section',
    group: 'admission',
    kind: 'fk',
    fkLookup: 'attendance_groups',
    filter: {
      exists: {
        table: 'student_groups',
        alias: 'f_sg',
        correlation: 'f_sg.student_id = s.id',
        valueExpr: 'f_sg.attendance_group_id',
      },
    },
    select: { expr: 'att_group.name', joins: ['att_group'] },
    sort: { expr: 'att_group.name', joins: ['att_group'] },
  },
  col('entry_type', 'Entry type', 'admission', 'enum', {
    enumValues: ENTRY_TYPES,
    enumLabels: ENTRY_TYPE_LABELS,
  }),
  col('pass_out_year', 'Pass-out year', 'admission', 'number'),

  // --- academic performance ----------------------------------------------
  col('tenth_percentage', '10th %', 'academic', 'number'),
  col('twelfth_percentage', '12th %', 'academic', 'number'),
  col('diploma_percentage', 'Diploma %', 'academic', 'number'),
  col('ug_cgpa', 'UG CGPA', 'academic', 'number'),
  col('current_backlogs', 'Current backlogs', 'academic', 'number'),
  col('backlog_history', 'Ever had a backlog', 'academic', 'boolean'),
  col('year_of_gap', 'Years of gap', 'academic', 'number'),
  col('reason_of_gap', 'Reason of gap', 'academic', 'string'),
  {
    // Derived boolean — no stored column, so filter/sort on the expression
    // and never select it raw (select mirrors the same CASE).
    key: 'has_resume',
    label: 'Has resume',
    group: 'academic',
    kind: 'boolean',
    operators: ['eq'],
    filter: { expr: '(s.resume_key IS NOT NULL OR s.resume_external_url IS NOT NULL)' },
    select: { expr: '(s.resume_key IS NOT NULL OR s.resume_external_url IS NOT NULL)' },
  },
  col('resume_uploaded_at', 'Resume uploaded at', 'academic', 'date'),

  // --- certifications -----------------------------------------------------
  {
    key: 'industry_certifications',
    label: 'Industry certifications',
    group: 'certifications',
    kind: 'fk',
    fkLookup: 'industry_certifications',
    operators: ['in', 'not_in'],
    filter: {
      exists: {
        table: 'student_industry_certifications',
        alias: 'f_sic',
        correlation: 'f_sic.student_id = s.id',
        valueExpr: 'f_sic.industry_certification_id',
      },
    },
    select: { hydrate: 'certifications' },
  },

  // --- placement ----------------------------------------------------------
  col('allowed_by_dept_for_placements', 'Allowed by dept for placements',
    'placement', 'boolean'),
  col('interested_in_placements_self', 'Interested in placements',
    'placement', 'boolean'),

  // --- parent & guardian --------------------------------------------------
  col('parent_name', 'Parent name', 'parent', 'string'),
  col('parent_mobile', 'Parent mobile', 'parent', 'string'),
  col('parent_email', 'Parent email', 'parent', 'string'),
  col('guardian_name', 'Guardian name', 'parent', 'string'),
  col('guardian_mobile', 'Guardian mobile', 'parent', 'string'),
  col('guardian_email', 'Guardian email', 'parent', 'string'),

  // --- address ------------------------------------------------------------
  col('home_address', 'Home address', 'address', 'string'),
  col('home_pincode', 'Home pincode', 'address', 'string'),
  fk('home_district', 'Home district', 'address', 'districts', 'home_district',
    'home_district.name'),
  fk('home_state', 'Home state', 'address', 'states', 'home_state',
    'home_state.name'),
  fk('home_country', 'Home country', 'address', 'countries', 'home_country',
    'home_country.name'),

  // --- entrance exam ------------------------------------------------------
  col('entrance_exam_na', 'Entrance exam N/A', 'entrance', 'boolean'),
  fk('entrance_exam', 'Entrance exam', 'entrance', 'entrance_exams',
    'entrance_exam', 'entrance_exam.name'),
  col('entrance_exam_rank', 'Entrance exam rank', 'entrance', 'number'),
  col('entrance_exam_year', 'Entrance exam year', 'entrance', 'number'),

  // --- 10th ---------------------------------------------------------------
  fk('tenth_board', '10th board', 'tenth', 'school_boards_x', 'tenth_board',
    'tenth_board.name'),
  col('tenth_institution', '10th institution', 'tenth', 'string'),
  col('tenth_year_of_pass', '10th year of pass', 'tenth', 'number'),
  fk('tenth_state', '10th state', 'tenth', 'states', 'tenth_state',
    'tenth_state.name'),

  // --- 12th ---------------------------------------------------------------
  fk('twelfth_board', '12th board', 'twelfth', 'school_boards_xii',
    'twelfth_board', 'twelfth_board.name'),
  col('twelfth_institution', '12th institution', 'twelfth', 'string'),
  col('twelfth_year_of_pass', '12th year of pass', 'twelfth', 'number'),
  fk('twelfth_state', '12th state', 'twelfth', 'states', 'twelfth_state',
    'twelfth_state.name'),

  // --- diploma ------------------------------------------------------------
  fk('diploma_board', 'Diploma board', 'diploma', 'diploma_boards',
    'diploma_board', 'diploma_board.name'),
  col('diploma_institution', 'Diploma institution', 'diploma', 'string'),
  col('diploma_year_of_pass', 'Diploma year of pass', 'diploma', 'number'),
  col('diploma_specialization', 'Diploma specialization', 'diploma', 'string'),
  fk('diploma_state', 'Diploma state', 'diploma', 'states', 'diploma_state',
    'diploma_state.name'),

  // --- government IDs (admin surface only) --------------------------------
  col('aadhaar_number', 'Aadhaar number', 'gov_ids', 'string', {
    surfaces: ['admin'],
  }),
  col('pan_number', 'PAN number', 'gov_ids', 'string', {
    surfaces: ['admin'],
  }),

  // --- system -------------------------------------------------------------
  col('is_active', 'Active', 'system', 'boolean'),
  col('created_at', 'Created at', 'system', 'date'),
  col('updated_at', 'Updated at', 'system', 'date'),
];

export const ATTRIBUTE_BY_KEY: ReadonlyMap<string, AttributeDef> = new Map(
  STUDENT_ATTRIBUTES.map((a) => [a.key, a]),
);

export function operatorsFor(def: AttributeDef): readonly Operator[] {
  return def.operators ?? DEFAULT_OPERATORS[def.kind];
}

/** Columns present on every row regardless of the requested column set. */
export const IMPLICIT_COLUMNS = ['id', 'student_id', 'display_name'] as const;

export const DEFAULT_COLUMNS = [
  'programme',
  'admission_year',
  'email',
  'mobile_number',
] as const;

export const DEFAULT_SORT = { by: 'display_name', dir: 'asc' } as const;

export const SEARCH_ATTRIBUTES = STUDENT_ATTRIBUTES.filter(
  (a) => a.searchable,
).map((a) => a.key);

/**
 * Boot-time sanity check — a broken registry entry must kill startup, not
 * silently emit bad SQL. Called from StudentQueryModule's constructor.
 */
export function assertRegistryValid(): void {
  const seen = new Set<string>();
  for (const def of STUDENT_ATTRIBUTES) {
    if (seen.has(def.key)) {
      throw new Error(`student-query registry: duplicate key '${def.key}'`);
    }
    seen.add(def.key);
    if ((IMPLICIT_COLUMNS as readonly string[]).includes(def.key) && def.key !== 'student_id' && def.key !== 'display_name') {
      throw new Error(
        `student-query registry: '${def.key}' collides with an implicit column`,
      );
    }
    for (const facet of [def.filter, def.select, def.sort]) {
      if (!facet || isHydrateFacet(facet as never)) continue;
      if (isSqlFacet(facet as FilterFacet)) {
        for (const j of (facet as { joins?: JoinId[] }).joins ?? []) {
          if (!JOINS[j]) {
            throw new Error(
              `student-query registry: '${def.key}' references unknown join '${j}'`,
            );
          }
        }
      }
    }
    if (def.searchable) {
      const f = def.filter;
      if (!f || !isSqlFacet(f) || !f.expr.startsWith('s.') || def.kind !== 'string') {
        throw new Error(
          `student-query registry: searchable '${def.key}' must be a flat s.* string column`,
        );
      }
    }
    if (def.kind === 'fk' && !def.fkLookup) {
      throw new Error(
        `student-query registry: fk attr '${def.key}' is missing fkLookup`,
      );
    }
    if (def.kind === 'enum' && !def.enumValues?.length) {
      throw new Error(
        `student-query registry: enum attr '${def.key}' is missing enumValues`,
      );
    }
  }
  for (const key of [...DEFAULT_COLUMNS, DEFAULT_SORT.by]) {
    if (!ATTRIBUTE_BY_KEY.has(key)) {
      throw new Error(`student-query registry: default refers to unknown '${key}'`);
    }
  }
}
