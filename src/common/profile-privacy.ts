/**
 * Personal profile attributes a student may hide from peer viewers (the
 * classmate profile shown in chat). Name + roll number and academic identity
 * are always visible and never appear here. This is the single source of truth
 * shared by the privacy DTO, the privacy service, and the peer-profile filter.
 *
 * Two fields get their own boolean column instead of the jsonb array:
 *  - `birthday` → `students.birthday_hidden` (default false = visible) so the
 *    set-based birthdays query stays sargable.
 *  - `mobile` → `students.mobile_hidden` (default **true = hidden**) because a
 *    phone number is sensitive PII; a student opts in to show it. A column is
 *    needed to express this inverted default ("empty jsonb = visible" can't).
 *
 * Everything else lives in `students.hidden_profile_fields` (jsonb, default '[]'
 * = visible). The privacy service merges all three into this flat key list.
 */
export const HIDEABLE_PROFILE_FIELDS = [
  'photo',
  'email',
  'mobile',
  'blood_group',
  'gender',
  'birthday',
] as const;

export type HideableProfileField = (typeof HIDEABLE_PROFILE_FIELDS)[number];

/** Fields hidden by default (shown only when the student opts in). */
export const HIDDEN_BY_DEFAULT_FIELDS: HideableProfileField[] = ['mobile'];

/**
 * The hideable fields stored in the jsonb array — everything except the two
 * column-backed fields (`birthday`, `mobile`).
 */
export const JSONB_HIDEABLE_FIELDS: HideableProfileField[] = [
  'photo',
  'email',
  'blood_group',
  'gender',
];
