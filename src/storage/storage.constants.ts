import { randomUUID } from 'node:crypto';

/**
 * Central registry of object-storage names — the single source of truth for the
 * bucket and every object-key namespace ("folder") used across the app.
 *
 * The app uses ONE bucket; features are separated by key prefix, not by bucket.
 * When a new feature starts writing objects, add its prefix to `STORAGE_PREFIX`
 * and a builder to `storageKey` here rather than hardcoding the string at the
 * call site — so all storage names stay greppable in one place and the templates
 * can never drift between call sites.
 *
 * Read/delete paths pass a key already stored on a DB column (e.g.
 * `Student.photo_key`, `Company.logo_key`), so they don't reference these.
 */

/** Default bucket name; overridden by the `S3_BUCKET` env var in `StorageService`. */
export const DEFAULT_STORAGE_BUCKET = 'nucleus';

/**
 * Top-level key prefixes ("folders") within the bucket. One entry per feature
 * that mints object keys.
 */
export const STORAGE_PREFIX = {
  /** Student ID-card photos: `student-photos/<uuid>.<ext>`. */
  studentPhotos: 'student-photos',
  /** Company logos: `companies/<companyId>/logo/<uuid>`. */
  companyLogos: 'companies',
  // Placeholder — company attachments (`Company.file_key`) will live under
  // `companies/<id>/attachments/...` once a write path exists; add the prefix
  // and a `storageKey` builder here when it lands.
} as const;

/**
 * Key builders — own the full templates (prefix + random id + shape) so every
 * call site produces identically-shaped keys. Prefer these over string literals.
 */
export const storageKey = {
  /** `student-photos/<uuid>.<ext>` */
  studentPhoto: (ext: string): string =>
    `${STORAGE_PREFIX.studentPhotos}/${randomUUID()}.${ext}`,
  /** `companies/<companyId>/logo/<uuid>` */
  companyLogo: (companyId: number): string =>
    `${STORAGE_PREFIX.companyLogos}/${companyId}/logo/${randomUUID()}`,
} as const;
