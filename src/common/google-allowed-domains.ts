/**
 * Google sign-in domain allowlist, shared by the admin, employee and student
 * OIDC verifiers. All three read the same `GOOGLE_ADMIN_ALLOWED_DOMAINS` env
 * var; an empty list disables the domain check.
 */
export const GOOGLE_ALLOWED_DOMAINS_ENV = 'GOOGLE_ADMIN_ALLOWED_DOMAINS';

/** Parses a comma-separated domain list into trimmed, lowercased entries. */
export function parseGoogleAllowedDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * The account's domain: the Workspace `hd` claim when present, otherwise the
 * domain part of the email (consumer accounts such as gmail.com carry no `hd`).
 */
export function googleAccountDomain(payload: {
  hd?: string;
  email: string;
}): string {
  if (payload.hd) return payload.hd.toLowerCase();
  const at = payload.email.lastIndexOf('@');
  return at >= 0 ? payload.email.slice(at + 1).toLowerCase() : '';
}
