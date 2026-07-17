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
  /**
   * Industry-certification files: `student-certificates/<studentId>/<uuid>.<ext>`.
   * PRIVATE (presigned reads only). The student id is embedded so a staged
   * key's ownership is provable without a DB row — the profile-update request
   * flow rejects any key outside the requesting student's own folder.
   */
  studentCertificates: 'student-certificates',
  /**
   * Resumes: `resumes/<uuid>.pdf`. PRIVATE like everything else (presigned
   * reads only). The shareable link is the PERMANENT tokenized route
   * `GET /public/resumes/<Student.resume_public_token>`, which resolves the
   * current key at request time and 302s to a presigned URL — so a replace
   * mints a fresh key without ever changing the link HRs were given.
   */
  studentResumes: 'resumes',
  /**
   * Drive JD attachments: `drives/<driveId>/jd/<profileId>/<uuid>.<ext>`.
   * PRIVATE (presigned reads only). The drive id leads so every file for a drive
   * shares a prefix, and the profile id nests under it so a designation's JDs
   * stay grouped — both are useful when auditing a drive's files in the bucket.
   */
  drives: 'drives',
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
  /** `student-certificates/<studentId>/<uuid>.<ext>` */
  studentCertificate: (studentId: number, ext: string): string =>
    `${STORAGE_PREFIX.studentCertificates}/${studentId}/${randomUUID()}.${ext}`,
  /** `resumes/<uuid>.pdf` */
  studentResume: (): string =>
    `${STORAGE_PREFIX.studentResumes}/${randomUUID()}.pdf`,
  /** `drives/<driveId>/jd/<profileId>/<uuid>.<ext>` */
  driveJdAttachment: (
    driveId: number,
    profileId: number,
    ext: string,
  ): string =>
    `${STORAGE_PREFIX.drives}/${driveId}/jd/${profileId}/${randomUUID()}.${ext}`,
} as const;

/** True when `key` lives in the given student's own certificate folder. */
export function isStudentCertificateKey(
  key: string,
  studentId: number,
): boolean {
  return key.startsWith(`${STORAGE_PREFIX.studentCertificates}/${studentId}/`);
}
