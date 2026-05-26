import { z } from 'zod';

/**
 * Shared policy for any password an employee chooses themselves (first-login
 * change, voluntary change, reset-via-email). Deliberately stricter than the
 * raw login field so weak passwords can never be set, while login itself
 * accepts anything and simply fails closed.
 */
export const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');
