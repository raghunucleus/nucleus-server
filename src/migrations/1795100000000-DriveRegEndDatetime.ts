import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `registration_end_date` becomes a precise datetime so a drive's registration
 * window can close at a specific time, not just end-of-day. Stored as
 * `timestamptz` (an absolute instant) — the deadline is compared against
 * `now()` when a student accepts and by the hourly auto-reject sweep, so it must
 * be timezone-correct. `drive_date` stays a plain `date`.
 *
 * Existing date-only rows cast to midnight of that day, which is the sensible
 * interpretation of a legacy end-of-registration date.
 */
export class DriveRegEndDatetime1795100000000 implements MigrationInterface {
  name = 'DriveRegEndDatetime1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drives" ALTER COLUMN "registration_end_date" ` +
        `TYPE timestamptz USING "registration_end_date"::timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drives" ALTER COLUMN "registration_end_date" ` +
        `TYPE date USING "registration_end_date"::date`,
    );
  }
}
