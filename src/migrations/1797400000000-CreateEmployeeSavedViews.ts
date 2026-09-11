import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saved views for the Insights screens: a named snapshot of one screen's
 * address — tab, scope narrowing and the screen's own filters — that follows
 * the employee across devices. `search` is the query string without the
 * leading `?`; the client splices it onto `route`. `route` is stored beside
 * `screen_key` so a later route rename can be migrated rather than stranding
 * views. Pinned views surface as one-click chips on the Overview.
 *
 * Personal only (no sharing): every read and write is filtered by the acting
 * employee, and the row goes with the employee (CASCADE).
 */
export class CreateEmployeeSavedViews1797400000000 implements MigrationInterface {
  name = 'CreateEmployeeSavedViews1797400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "employee_saved_views" (` +
        `"id" SERIAL NOT NULL, ` +
        `"employee_id" integer NOT NULL, ` +
        `"screen_key" character varying(64) NOT NULL, ` +
        `"route" character varying(128) NOT NULL, ` +
        `"name" character varying(80) NOT NULL, ` +
        `"search" text NOT NULL DEFAULT '', ` +
        `"is_pinned" boolean NOT NULL DEFAULT false, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_employee_saved_views_employee_id_screen_key_name" UNIQUE ("employee_id", "screen_key", "name"), ` +
        `CONSTRAINT "PK_employee_saved_views_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employee_saved_views_employee_id" ON "employee_saved_views" ("employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_saved_views" ADD CONSTRAINT "FK_employee_saved_views_employee_id" ` +
        `FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employee_saved_views" DROP CONSTRAINT "FK_employee_saved_views_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_employee_saved_views_employee_id"`,
    );
    await queryRunner.query(`DROP TABLE "employee_saved_views"`);
  }
}
