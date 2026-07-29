import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Status history for CR View records — an append-only log of every
 * `current_status_id` transition on `company_job_role_years`, written inside
 * the record's save transaction. `status_id` is nullable: clearing back to
 * the master default is a real transition worth remembering.
 *
 * Constraint names abbreviate to `cjry_status_logs`; spelled out they would
 * exceed Postgres's 63-byte identifier limit (the `rel_types` precedent). The
 * table name stays spelled out.
 *
 * The backfill seeds one entry per record that already holds a status, stamped
 * with the record's own updated_by / updated_at — an approximation (the true
 * transition time is unknowable retroactively), but it means existing rows
 * open with their current status as the first history entry instead of an
 * empty list. Re-runnable: guarded on the log being empty.
 */
export class CreateCrViewStatusLogs1796600000000 implements MigrationInterface {
  name = 'CreateCrViewStatusLogs1796600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_status_logs" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"status_id" integer, ` +
        `"changed_by_employee_id" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_job_role_year_status_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cjry_status_logs_company_job_role_year_id" ON "company_job_role_year_status_logs" ("company_job_role_year_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_status_logs" ADD CONSTRAINT "FK_cjry_status_logs_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_status_logs" ADD CONSTRAINT "FK_cjry_status_logs_status_id" FOREIGN KEY ("status_id") REFERENCES "company_current_statuses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_status_logs" ADD CONSTRAINT "FK_cjry_status_logs_changed_by_employee_id" FOREIGN KEY ("changed_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ---- backfill ----------------------------------------------------------
    await queryRunner.query(
      `INSERT INTO "company_job_role_year_status_logs" ` +
        `("company_job_role_year_id", "status_id", "changed_by_employee_id", "created_at") ` +
        `SELECT "id", "current_status_id", "updated_by_employee_id", "updated_at" ` +
        `FROM "company_job_role_years" ` +
        `WHERE "current_status_id" IS NOT NULL ` +
        `AND NOT EXISTS (SELECT 1 FROM "company_job_role_year_status_logs")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "company_job_role_year_status_logs"`);
  }
}
