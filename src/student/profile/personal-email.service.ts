import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomInt } from 'crypto';
import { Redis } from 'ioredis';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import { MailService } from '../../mail/mail.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { StudentNotificationService } from '../notification/student-notification.service';
import { StudentEmailOtp } from './entities/student-email-otp.entity';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const RATE_LIMITS = {
  // Sends: per student and per target address, both hourly.
  requestByStudent: { max: 3, windowSeconds: 60 * 60 },
  requestByEmail: { max: 3, windowSeconds: 60 * 60 },
  verify: { max: 30, windowSeconds: 60 * 60 },
} as const;

export interface PersonalEmailState {
  personal_email: string | null;
  pending_email: string | null;
}

/**
 * The OTP_VERIFY edit policy for `personal_email`: no approver — proving
 * control of the inbox IS the approval gate. The new address is staged in
 * `personal_email_pending` and promoted to `personal_email` only after the
 * 6-digit code sent to it is verified. Mirrors the guardian OTP bootstrap
 * (hash-only storage, single-use, attempt-capped, Redis rate limits).
 */
@Injectable()
export class PersonalEmailService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(StudentEmailOtp)
    private readonly otps: Repository<StudentEmailOtp>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly mail: MailService,
    private readonly notifications: StudentNotificationService,
  ) {}

  /**
   * Stage `email` as the pending personal email and send it a fresh code.
   * Re-requesting (same or different address) invalidates every earlier code —
   * only the latest code for the latest address can ever promote.
   */
  async requestOtp(
    studentId: number,
    email: string,
  ): Promise<{ pending_email: string; expires_in_minutes: number }> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const target = email.toLowerCase();
    if (target === student.email.toLowerCase()) {
      throw new BadRequestException(
        'Personal email must be different from your college email.',
      );
    }
    if (student.personal_email && target === student.personal_email) {
      throw new BadRequestException(
        'This address is already your verified personal email.',
      );
    }

    await this.enforceRateLimit(
      'personal-email:send:student',
      String(studentId),
      RATE_LIMITS.requestByStudent,
    );
    await this.enforceRateLimit(
      'personal-email:send:email',
      target,
      RATE_LIMITS.requestByEmail,
    );

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.dataSource.transaction(async (tx) => {
      await tx
        .getRepository(Student)
        .update({ id: studentId }, { personal_email_pending: target });
      // Kill every earlier in-flight code (also covers "changed my mind to a
      // different address" — the old address's code must not verify).
      await tx
        .getRepository(StudentEmailOtp)
        .update(
          { student_id: studentId, consumed_at: IsNull() },
          { consumed_at: new Date() },
        );
      await tx.getRepository(StudentEmailOtp).save(
        tx.getRepository(StudentEmailOtp).create({
          student_id: studentId,
          email: target,
          otp_hash: this.hashOtp(otp),
          expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        }),
      );
    });

    await this.mail.sendStudentEmailOtp({
      to: target,
      displayName: student.display_name,
      otp,
      expiresInMinutes: OTP_TTL_MINUTES,
    });

    return { pending_email: target, expires_in_minutes: OTP_TTL_MINUTES };
  }

  /** Verify the latest code; on success promote pending → personal_email. */
  async verifyOtp(
    studentId: number,
    code: string,
  ): Promise<PersonalEmailState> {
    await this.enforceRateLimit(
      'personal-email:verify',
      String(studentId),
      RATE_LIMITS.verify,
    );

    const invalid = new BadRequestException(
      'Incorrect or expired code. Check the code or request a new one.',
    );

    const row = await this.otps.findOne({
      where: { student_id: studentId, consumed_at: IsNull() },
      order: { created_at: 'DESC' },
    });
    if (!row || row.expires_at.getTime() < Date.now()) throw invalid;
    if (row.attempt_count >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts — request a new code.',
      );
    }
    if (row.otp_hash !== this.hashOtp(code)) {
      await this.otps.update(
        { id: row.id },
        { attempt_count: row.attempt_count + 1 },
      );
      throw invalid;
    }

    const state = await this.dataSource.transaction(async (tx) => {
      const student = await tx
        .getRepository(Student)
        .findOne({ where: { id: studentId } });
      if (!student) throw new NotFoundException('Student not found');
      // The code must still match the staged address (an admin may have
      // cleared/changed it since the send).
      if (student.personal_email_pending !== row.email) throw invalid;

      await tx
        .getRepository(Student)
        .update(
          { id: studentId },
          { personal_email: row.email, personal_email_pending: null },
        );
      await tx
        .getRepository(StudentEmailOtp)
        .update({ id: row.id }, { consumed_at: new Date() });
      return {
        personal_email: row.email,
        pending_email: null,
      } satisfies PersonalEmailState;
    });

    void this.notifications
      .send(studentId, {
        module: 'profile',
        type: 'personal-email-verified',
        title: 'Personal email verified',
        body: `${state.personal_email} is now the personal email on your profile.`,
        target: null,
      })
      .catch(() => undefined);

    return state;
  }

  /** Abandon an unverified pending address (and its in-flight codes). */
  async cancelPending(studentId: number): Promise<PersonalEmailState> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    await this.dataSource.transaction(async (tx) => {
      await tx
        .getRepository(Student)
        .update({ id: studentId }, { personal_email_pending: null });
      await tx
        .getRepository(StudentEmailOtp)
        .update(
          { student_id: studentId, consumed_at: IsNull() },
          { consumed_at: new Date() },
        );
    });

    return {
      personal_email: student.personal_email,
      pending_email: null,
    };
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private async enforceRateLimit(
    bucket: string,
    subject: string,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    const key = `student:rl:${bucket}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, limit.windowSeconds);
    if (count > limit.max) {
      throw new HttpException(
        'Too many requests. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
