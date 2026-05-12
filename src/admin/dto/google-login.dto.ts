import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Google ID tokens are JWTs. They're well over 100 bytes and capped well under
// 4 KB in practice — bound the input to keep request bodies small.
export const GoogleLoginSchema = z.object({
  idToken: z.string().min(100).max(4096),
});

export class GoogleLoginDto extends createZodDto(GoogleLoginSchema) {}
