import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { Student } from '../../admin/entities/student.entity';
import { SecurityPassKind } from '../../common/security-pass';
import { SecurityPassService } from '../../security-pass/security-pass.service';
import { StorageService } from '../../storage/storage.service';

export type VerifyReason = 'expired' | 'invalid' | 'inactive' | 'unknown';

export interface VerifyIdentity {
  /** Display name. */
  name: string;
  /** emp_code or roll number. */
  code: string;
  is_active: boolean;
  /** Short-lived presigned photo URL (students only), else null. */
  photo_url: string | null;
  /** Secondary line: designation · department / programme · department. */
  primary_line: string | null;
}

export interface VerifyResult {
  /** True only when the pass is fresh AND the person is active. */
  valid: boolean;
  /** Why a scan failed — absent when valid. */
  reason?: VerifyReason;
  kind?: SecurityPassKind;
  /** Identity to show the guard. Present on success and on `inactive`. */
  identity?: VerifyIdentity;
}

// Match the ID-card photo TTL — long enough to render the scan result, short
// enough that a leaked URL self-expires before it's useful.
const PHOTO_URL_TTL_SECONDS = 15 * 60;

/**
 * Verifies a scanned security-pass QR for the security guard. The pass is
 * consumed (single-use) the moment its signature + freshness check passes —
 * before the identity lookup — so a scanned code is never replayable, even for
 * an inactive or unknown person.
 */
@Injectable()
export class SecurityVerifyService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly pass: SecurityPassService,
    private readonly storage: StorageService,
  ) {}

  async verify(qrToken: string): Promise<VerifyResult> {
    const r = await this.pass.consume(qrToken);
    if (!r.ok) return { valid: false, reason: r.reason };
    return r.kind === 'employee'
      ? this.verifyEmployee(r.sub)
      : this.verifyStudent(r.sub);
  }

  private async verifyEmployee(id: number): Promise<VerifyResult> {
    const e = await this.employees.findOne({ where: { id } });
    if (!e) return { valid: false, reason: 'unknown', kind: 'employee' };
    const identity: VerifyIdentity = {
      name: e.emp_display_name,
      code: e.emp_code,
      is_active: e.is_active,
      photo_url: null,
      primary_line: this.joinLine([e.designation?.name, e.department?.name]),
    };
    if (!e.is_active) {
      return { valid: false, reason: 'inactive', kind: 'employee', identity };
    }
    return { valid: true, kind: 'employee', identity };
  }

  private async verifyStudent(id: number): Promise<VerifyResult> {
    const s = await this.students.findOne({ where: { id } });
    if (!s) return { valid: false, reason: 'unknown', kind: 'student' };
    const identity: VerifyIdentity = {
      name: s.display_name,
      code: s.student_id,
      is_active: s.is_active,
      photo_url: await this.resolvePhotoUrl(s.photo_key),
      primary_line: this.joinLine([
        s.programme?.name,
        s.programme?.department?.short_name,
      ]),
    };
    if (!s.is_active) {
      return { valid: false, reason: 'inactive', kind: 'student', identity };
    }
    return { valid: true, kind: 'student', identity };
  }

  private joinLine(parts: Array<string | null | undefined>): string | null {
    const present = parts.filter((p): p is string => !!p);
    return present.length ? present.join(' · ') : null;
  }

  // Mirrors StudentIdCardService.resolvePhotoUrl — a missing object degrades to
  // null (the client falls back to an initials avatar) rather than 404-ing.
  private async resolvePhotoUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    const exists = await this.storage.objectExists(key);
    if (!exists) return null;
    return this.storage.getSignedReadUrl(key, PHOTO_URL_TTL_SECONDS);
  }
}
