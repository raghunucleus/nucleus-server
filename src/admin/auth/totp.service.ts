import { Injectable } from '@nestjs/common';
import {
  generateSecret as otpGenerateSecret,
  generateURI as otpGenerateURI,
  verify as otpVerify,
} from 'otplib';
import * as qrcode from 'qrcode';
import { randomBytes } from 'crypto';

const RECOVERY_CODE_COUNT = 8;
// Uppercase A-Z + 2-9, ambiguous chars (I, O, 0, 1) removed.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class TotpService {
  generateSecret(): string {
    return otpGenerateSecret();
  }

  buildOtpauthUrl(secret: string, accountName: string, issuer: string): string {
    return otpGenerateURI({
      strategy: 'totp',
      issuer,
      label: accountName,
      secret,
    });
  }

  generateQrDataUrl(otpauthUrl: string): Promise<string> {
    return qrcode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });
  }

  async verifyToken(secret: string, token: string): Promise<boolean> {
    try {
      const result = await otpVerify({ secret, token });
      return result.valid === true;
    } catch {
      return false;
    }
  }

  generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
    return Array.from({ length: count }, () => this.randomCode());
  }

  // Recovery codes are stored bcrypt-hashed and surfaced as e.g. "ABCD-EFGH".
  // Inputs are normalised by upper-casing and stripping dashes/whitespace
  // before hashing/comparison so the user can paste either form.
  normalizeRecoveryCode(input: string): string {
    return input.replace(/[\s-]+/g, '').toUpperCase();
  }

  private randomCode(): string {
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) {
      out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    }
    return `${out.slice(0, 4)}-${out.slice(4)}`;
  }
}
