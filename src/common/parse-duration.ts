/**
 * Parse a short duration string like "60s" / "15m" / "7d" / "365d" into a
 * number of seconds. Falls back to `fallbackSeconds` when the input is missing
 * or malformed. A bare number is treated as seconds.
 */
export function parseDurationToSeconds(
  input: string | undefined,
  fallbackSeconds = 60,
): number {
  if (!input) return fallbackSeconds;
  const match = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!match) return fallbackSeconds;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[unit];
}
