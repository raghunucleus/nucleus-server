import { z } from 'zod';

/**
 * Optional device identity every login body may carry. Spread into each
 * audience's login schema. Snake_case like the rest of the login fields — the
 * schemas are non-strict, so a misspelt key would be silently stripped and
 * same-device replacement would quietly never happen.
 */
export const DeviceFieldsShape = {
  /** Persistent per-install / per-browser id minted by the client. */
  device_id: z.string().trim().min(1).max(64).optional(),
  /** Human label, e.g. "Pixel 7 · Android 14". Web omits it (UA is parsed). */
  device_name: z.string().trim().min(1).max(128).optional(),
};
