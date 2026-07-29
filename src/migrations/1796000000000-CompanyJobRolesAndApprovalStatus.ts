import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three changes that ship together because the company approval flow needs all
 * of them:
 *
 * 1. `company_job_roles` — the job roles a company recruits for, each with the
 *    employee accountable for it.
 * 2. `companies.is_approved` (boolean) → `approval_status` (varchar), because
 *    there are now three states: pending / approved / rejected. Two booleans
 *    would make four representable states for three legal ones.
 * 3. `approval_requests.action_key` — the routing key for EMPLOYEE-raised
 *    requests. Student requests route by `programme_admission_year_id` to that
 *    batch's profile verifiers; employee requests route by action key to the
 *    approvers assigned in `approval_action_approvers`. Nullable, no backfill:
 *    every pre-existing row is a student request.
 *
 * Backfill: companies that record a creator get one job role named "General"
 * owned by that employee. Companies with no creator (seeded/imported) get
 * nothing — there is no truthful owner to invent, and the UI tolerates zero
 * roles. Those heal as the catalog is edited, since the form requires at least
 * one role on save.
 */
export class CompanyJobRolesAndApprovalStatus1796000000000 implements MigrationInterface {
  name = 'CompanyJobRolesAndApprovalStatus1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- company_job_roles --------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_job_roles" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"role_name" character varying(160) NOT NULL, ` +
        `"responsible_employee_id" integer NOT NULL, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_company_job_roles_company_id_role_name" UNIQUE ("company_id", "role_name"), ` +
        `CONSTRAINT "PK_company_job_roles" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_roles_company_id" ON "company_job_roles" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_roles_responsible_employee_id" ON "company_job_roles" ("responsible_employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_roles" ADD CONSTRAINT "FK_company_job_roles_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_roles" ADD CONSTRAINT "FK_company_job_roles_responsible_employee_id" FOREIGN KEY ("responsible_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- companies.approval_status ------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "companies" ADD "approval_status" character varying(16) NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `UPDATE "companies" SET "approval_status" = CASE WHEN "is_approved" THEN 'approved' ELSE 'pending' END`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" DROP COLUMN "is_approved"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_companies_approval_status" ON "companies" ("approval_status")`,
    );

    // --- Backfill one "General" role per company that records a creator -----
    await queryRunner.query(
      `INSERT INTO "company_job_roles" ("company_id", "role_name", "responsible_employee_id") ` +
        `SELECT c."id", 'General', c."created_by_employee_id" FROM "companies" c ` +
        `WHERE c."created_by_employee_id" IS NOT NULL ` +
        // Defensive: a creator whose employee row is gone would violate the FK.
        `AND EXISTS (SELECT 1 FROM "employees" e WHERE e."id" = c."created_by_employee_id")`,
    );

    // --- approval_requests.action_key ---------------------------------------
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD "action_key" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_requests_action_key_status" ON "approval_requests" ("action_key", "status")`,
    );
    // An employee-raised request with no action key would be unroutable — it
    // would sit in nobody's inbox and nobody could decide it.
    //
    // Deliberately NOT `num_nonnulls(programme_admission_year_id, action_key) = 1`:
    // `programme_admission_year_id` is ON DELETE SET NULL, so deleting a batch
    // would violate that retroactively on historical student rows.
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "CHK_approval_requests_employee_requester_action_key" ` +
        `CHECK ("requester_employee_id" IS NULL OR "action_key" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "CHK_approval_requests_employee_requester_action_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_requests_action_key_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP COLUMN "action_key"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_companies_approval_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD "is_approved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "companies" SET "is_approved" = ("approval_status" = 'approved')`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" DROP COLUMN "approval_status"`,
    );

    await queryRunner.query(`DROP TABLE "company_job_roles"`);
  }
}
