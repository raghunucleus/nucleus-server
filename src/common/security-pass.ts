/**
 * Shared types for the single-use security-pass QR — the short-lived token
 * rendered on a student/employee ID card and scanned by the security app to
 * verify a person's identity. Issued by `SecurityPassService` (see
 * src/security-pass/), consumed by the security-verify endpoint.
 */

export type SecurityPassKind = 'employee' | 'student';

/** Claims embedded in the security-pass QR JWT. Verified server-side. */
export interface SecurityPassPayload {
  kind: SecurityPassKind;
  /** employees.id or students.id — the lookup key after verification. */
  sub: number;
  /** emp_code or roll number — shown to the guard; never the lookup key. */
  code: string;
  typ: 'security-pass';
  /**
   * Unique per issue. Matched against the per-person Redis key so a pass is
   * single-use and a re-issue (Regenerate) instantly invalidates the previous.
   */
  jti: string;
}

/** Pass payload returned to the generating client to render + count down. */
export interface SecurityPassResponse {
  qr_token: string;
  ttl_seconds: number;
  /** ISO timestamp the pass expires at — informational for the client. */
  expires_at: string;
}
