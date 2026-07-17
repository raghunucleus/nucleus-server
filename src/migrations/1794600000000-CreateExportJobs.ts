import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Async export jobs: one row per employee-requested file export (student
 * search → CSV/XLSX today; generic by design). The file itself lives in object
 * storage under `exports/<employeeId>/...` and expires 24h after completion —
 * rows outlive their objects so an expired download can be answered precisely.
 */
export class CreateExportJobs1794600000000 implements MigrationInterface {
  name = 'CreateExportJobs1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "export_jobs" (
        "id" SERIAL NOT NULL,
        "employee_id" integer NOT NULL,
        "source" character varying(64) NOT NULL,
        "label" character varying(255) NOT NULL,
        "context" jsonb,
        "format" character varying(8) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "storage_key" character varying(512),
        "filename" character varying(255),
        "row_count" integer,
        "error" character varying(512),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_export_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_export_jobs_employee_id_created_at" ON "export_jobs" ("employee_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_export_jobs_status_expires_at" ON "export_jobs" ("status", "expires_at")`,
    );
    await queryRunner.query(`
      ALTER TABLE "export_jobs"
        ADD CONSTRAINT "FK_export_jobs_employee_id"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "export_jobs" DROP CONSTRAINT "FK_export_jobs_employee_id"`,
    );
    await queryRunner.query(`DROP TABLE "export_jobs"`);
  }
}
