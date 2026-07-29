import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The second wave of domain fields on `company_job_role_years` — everything CR
 * View records beyond relationship types and current status:
 *
 * - Designations / programmes / job locations pursued this year. MULTI-selects,
 *   so join tables — referencing the Drive Attributes masters
 *   (`drive_designations`, `drive_job_locations`) and the academics master
 *   (`programmes`) rather than growing CR-only copies of the same lists.
 * - HR contacts — a repeatable group, so a child table (`drive_profiles` is the
 *   model), ordered by `sort_order`.
 * - Next follow-up date and remarks — two scalar columns.
 *
 * No seeds: every referenced master already exists and ships its own.
 *
 * The lookup sides of the join tables are RESTRICT, deliberately unlike
 * `drive_job_locations_link` (CASCADE): a drive is operational data that can
 * shed a deleted location, but a CR record is history that must not be silently
 * rewritten. The masters only deactivate today, so RESTRICT costs nothing. The
 * record sides all CASCADE — `company_job_role_years` itself cascades off
 * `company_job_roles`, so RESTRICT there would block deleting a job role.
 *
 * Constraint names stay under Postgres's 63-byte identifier limit (checked by
 * hand; the longest, `FK_company_job_role_year_designations_company_job_role_
 * year_id`, is 62). Table names stay spelled out, same doctrine as the
 * `rel_types` migration.
 */
export class AddCrViewRecordFields1796500000000 implements MigrationInterface {
  name = 'AddCrViewRecordFields1796500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- scalar fields on the year record ----------------------------------
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD "next_follow_up_date" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD "remarks" character varying(1000)`,
    );
    // A sort column on the screen ("who do I call next"), hence the index.
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_years_next_follow_up_date" ON "company_job_role_years" ("next_follow_up_date")`,
    );

    // ---- designations ------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_designations" (` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"designation_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_company_job_role_year_designations" PRIMARY KEY ("company_job_role_year_id", "designation_id"))`,
    );
    // The PK covers lookups leading with the record; this serves the reverse
    // ("which records use this designation") — what a deactivation check asks.
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_year_designations_designation_id" ON "company_job_role_year_designations" ("designation_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_designations" ADD CONSTRAINT "FK_company_job_role_year_designations_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_designations" ADD CONSTRAINT "FK_company_job_role_year_designations_designation_id" FOREIGN KEY ("designation_id") REFERENCES "drive_designations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ---- programmes --------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_programmes" (` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"programme_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_company_job_role_year_programmes" PRIMARY KEY ("company_job_role_year_id", "programme_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_year_programmes_programme_id" ON "company_job_role_year_programmes" ("programme_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_programmes" ADD CONSTRAINT "FK_company_job_role_year_programmes_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_programmes" ADD CONSTRAINT "FK_company_job_role_year_programmes_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ---- job locations -----------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_locations" (` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"job_location_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_company_job_role_year_locations" PRIMARY KEY ("company_job_role_year_id", "job_location_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_year_locations_job_location_id" ON "company_job_role_year_locations" ("job_location_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_locations" ADD CONSTRAINT "FK_company_job_role_year_locations_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_locations" ADD CONSTRAINT "FK_company_job_role_year_locations_job_location_id" FOREIGN KEY ("job_location_id") REFERENCES "drive_job_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ---- HR contacts -------------------------------------------------------
    // Only `hr_name` is NOT NULL; formats are the DTO's job (`hr_landline` is
    // deliberately loose free text, same doctrine as `drives.spoc_contact`).
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_contacts" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"hr_name" character varying(160) NOT NULL, ` +
        `"hr_designation" character varying(160), ` +
        `"hr_mobile" character varying(16), ` +
        `"hr_landline" character varying(32), ` +
        `"hr_email" character varying(255), ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_job_role_year_contacts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_year_contacts_company_job_role_year_id" ON "company_job_role_year_contacts" ("company_job_role_year_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_contacts" ADD CONSTRAINT "FK_company_job_role_year_contacts_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Children of the record first; the scalar columns last.
    await queryRunner.query(`DROP TABLE "company_job_role_year_contacts"`);
    await queryRunner.query(`DROP TABLE "company_job_role_year_locations"`);
    await queryRunner.query(`DROP TABLE "company_job_role_year_programmes"`);
    await queryRunner.query(`DROP TABLE "company_job_role_year_designations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_company_job_role_years_next_follow_up_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP COLUMN "remarks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP COLUMN "next_follow_up_date"`,
    );
  }
}
