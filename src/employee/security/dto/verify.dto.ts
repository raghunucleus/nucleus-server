import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A scanned QR payload to verify. The raw signed security-pass token. */
export const VerifySchema = z.object({
  qr_token: z.string().trim().min(1).max(4096),
});

export class VerifyDto extends createZodDto(VerifySchema) {}
