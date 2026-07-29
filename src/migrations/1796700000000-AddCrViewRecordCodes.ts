import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Human-readable reference codes for CR View records —
 * `CR-<passout year>-<record id zero-padded to 5>`, e.g. `CR-2027-00042`.
 *
 * The number is the record's own primary key, so the code is unique by
 * construction and immutable by policy: other modules will quote it, and a
 * reference key must survive company/role renames — which is why it is not
 * derived from names. New rows are stamped by the service right after the
 * insert; this migration backfills every record that already exists.
 * Re-runnable: the backfill only touches NULL codes.
 */
export class AddCrViewRecordCodes1796700000000 implements MigrationInterface {
  name = 'AddCrViewRecordCodes1796700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD "record_code" character varying(24)`,
    );

    // Backfill BEFORE the unique constraint, so a partial earlier run can
    // never leave duplicates that block it (the id makes duplicates
    // impossible anyway; the ordering just keeps the failure mode clean).
    await queryRunner.query(
      `UPDATE "company_job_role_years" r SET "record_code" = ` +
        `'CR-' || p."passout_year" || '-' || lpad(r."id"::text, 5, '0') ` +
        `FROM "passout_years" p ` +
        `WHERE p."id" = r."passout_year_id" AND r."record_code" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "UQ_company_job_role_years_record_code" UNIQUE ("record_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP CONSTRAINT "UQ_company_job_role_years_record_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP COLUMN "record_code"`,
    );
  }
}
