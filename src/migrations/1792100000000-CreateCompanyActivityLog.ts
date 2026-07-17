import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Company-wide audit trail (`company_activity_log`) powering the unified
 * Activity tab: one append-only row per CRM mutation, attributed to the acting
 * employee. Separate migration layered on top of the base corporate-relations
 * schema (1792000000000).
 */
export class CreateCompanyActivityLog1792100000000 implements MigrationInterface {
  name = 'CreateCompanyActivityLog1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "company_activity_log" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"employee_id" integer NOT NULL, ` +
        `"action" character varying(32) NOT NULL, ` +
        `"entity_type" character varying(24) NOT NULL, ` +
        `"entity_id" integer, ` +
        `"summary" text NOT NULL, ` +
        `"changes" jsonb, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_activity_log" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_activity_log_company_id" ON "company_activity_log" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_activity_log_company_id_created_at" ON "company_activity_log" ("company_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_activity_log" ADD CONSTRAINT "FK_company_activity_log_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_activity_log" ADD CONSTRAINT "FK_company_activity_log_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "company_activity_log"`);
  }
}
