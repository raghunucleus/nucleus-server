import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `company_job_role_years` — what the responsible person recorded for one job
 * role in one passout year. Backs the CR View screen.
 *
 * No backfill and no seed: rows are materialized lazily, only when someone
 * actually saves against a (role, year) pair. Pre-creating `roles × years`
 * empty rows would multiply the row count by the number of active years for
 * zero information, and CR View renders a missing row as "nothing recorded yet"
 * anyway.
 *
 * The table ships with no domain columns — those are still being specified.
 * This creates the key, the audit stamps and the constraints so adding a field
 * later is a plain `ALTER TABLE … ADD COLUMN`.
 *
 * FK behaviours (see the entity docblock for the full reasoning): the role is
 * CASCADE because the two role writers both delete-what's-absent and RESTRICT
 * would make those edits throw; the passout year is RESTRICT because the master
 * has no delete path; the audit columns are SET NULL so an HR deletion can
 * never block anything.
 */
export class CreateCompanyJobRoleYears1796200000000 implements MigrationInterface {
  name = 'CreateCompanyJobRoleYears1796200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "company_job_role_years" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_job_role_id" integer NOT NULL, ` +
        `"passout_year_id" integer NOT NULL, ` +
        `"created_by_employee_id" integer, ` +
        `"updated_by_employee_id" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        // 61 of the 63 bytes Postgres allows for an identifier. Any longer and
        // it would be silently truncated, which breaks `down()` and any
        // `ON CONFLICT ON CONSTRAINT` that names it.
        `CONSTRAINT "UQ_company_job_role_years_company_job_role_id_passout_year_id" UNIQUE ("company_job_role_id", "passout_year_id"), ` +
        `CONSTRAINT "PK_company_job_role_years" PRIMARY KEY ("id"))`,
    );
    // The unique constraint's backing index already covers lookups leading with
    // `company_job_role_id`; this one serves the year-scoped list.
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_years_passout_year_id" ON "company_job_role_years" ("passout_year_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "FK_company_job_role_years_company_job_role_id" FOREIGN KEY ("company_job_role_id") REFERENCES "company_job_roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "FK_company_job_role_years_passout_year_id" FOREIGN KEY ("passout_year_id") REFERENCES "passout_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "FK_company_job_role_years_created_by_employee_id" FOREIGN KEY ("created_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "FK_company_job_role_years_updated_by_employee_id" FOREIGN KEY ("updated_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "company_job_role_years"`);
  }
}
