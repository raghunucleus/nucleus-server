import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Placement drives — the surface that makes the drive attribute lookups mean
 * something. A drive belongs to a company and hires for one or more
 * designations ("profiles").
 *
 * Five tables: `drives`, its two classifier join tables, `drive_profiles` (one
 * per designation) and that table's own job-location join + JD attachments.
 *
 * Schema only — there is nothing sensible to seed, unlike the lookup migrations
 * this sits beside.
 *
 * FK delete rules encode what may be destroyed:
 *  - lookup + company references are RESTRICT — deactivate a classifier, never
 *    delete one out from under a drive that cites it;
 *  - `drive_id` / `drive_profile_id` are CASCADE — profiles, their locations and
 *    their attachments are parts of the drive, not independent records.
 *    (Cascading away an attachment row leaves its object in the bucket; the
 *    service deletes bytes explicitly, and orphans are harmless — the key is
 *    unreachable without the row.)
 */
export class CreateDrives1794300000000 implements MigrationInterface {
  name = 'CreateDrives1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- drives -----------------------------------------------------------
    // `*_scope` says where each switchable field is captured: 'drive' (the
    // column here) or 'designation' (the column on drive_profiles). Exactly one
    // side is populated; the service enforces that, not a CHECK — the rule spans
    // two tables.
    //
    // Stipend/CTC have no scope column: they follow `offer_type_scope`, since a
    // package is meaningless without the offer type that says whether it is a
    // stipend or a CTC.
    await queryRunner.query(
      `CREATE TABLE "drives" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"drive_name" character varying(255) NOT NULL, ` +
        `"profile_type" character varying(16) NOT NULL DEFAULT 'single', ` +
        `"offer_type_scope" character varying(16) NOT NULL DEFAULT 'drive', ` +
        `"job_location_scope" character varying(16) NOT NULL DEFAULT 'drive', ` +
        `"placement_category_scope" character varying(16) NOT NULL DEFAULT 'drive', ` +
        `"bond_scope" character varying(16) NOT NULL DEFAULT 'drive', ` +
        `"offer_type_id" integer, ` +
        `"has_bond" boolean, ` +
        `"bond_years" integer, ` +
        `"bond_desc" jsonb, ` +
        `"stipend_mode" character varying(8), ` +
        `"stipend_min" numeric(12,2), ` +
        `"stipend_max" numeric(12,2), ` +
        `"ctc_mode" character varying(8), ` +
        `"ctc_min" numeric(12,2), ` +
        `"ctc_max" numeric(12,2), ` +
        `"spoc_email" character varying(255), ` +
        `"spoc_contact" character varying(32), ` +
        `"registration_end_date" date, ` +
        `"drive_date" date, ` +
        `"created_by_employee_id" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_drives" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drives_company_id" ON "drives" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drives_drive_date" ON "drives" ("drive_date")`,
    );

    // --- drive_profiles ---------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "drive_profiles" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_id" integer NOT NULL, ` +
        `"designation_id" integer NOT NULL, ` +
        `"jd" jsonb, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"offer_type_id" integer, ` +
        `"has_bond" boolean, ` +
        `"bond_years" integer, ` +
        `"bond_desc" jsonb, ` +
        `"stipend_mode" character varying(8), ` +
        `"stipend_min" numeric(12,2), ` +
        `"stipend_max" numeric(12,2), ` +
        `"ctc_mode" character varying(8), ` +
        `"ctc_min" numeric(12,2), ` +
        `"ctc_max" numeric(12,2), ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_drive_profiles_drive_id_designation_id" UNIQUE ("drive_id", "designation_id"), ` +
        `CONSTRAINT "PK_drive_profiles" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_profiles_drive_id" ON "drive_profiles" ("drive_id")`,
    );

    // --- drive_profile_attachments ----------------------------------------
    await queryRunner.query(
      `CREATE TABLE "drive_profile_attachments" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_profile_id" integer NOT NULL, ` +
        `"file_key" character varying(512) NOT NULL, ` +
        `"file_name" character varying(255) NOT NULL, ` +
        `"content_type" character varying(128), ` +
        `"size_bytes" integer, ` +
        `"uploaded_by" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_drive_profile_attachments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_profile_attachments_drive_profile_id" ` +
        `ON "drive_profile_attachments" ("drive_profile_id")`,
    );

    // --- Join tables ------------------------------------------------------
    // Composite PKs — a drive can cite a category once, and dropping the row is
    // the only "update" these tables ever see.
    await queryRunner.query(
      `CREATE TABLE "drive_company_categories_link" (` +
        `"drive_id" integer NOT NULL, ` +
        `"category_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_company_categories_link" PRIMARY KEY ("drive_id", "category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_company_categories_link_drive_id" ` +
        `ON "drive_company_categories_link" ("drive_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_job_locations_link" (` +
        `"drive_id" integer NOT NULL, ` +
        `"job_location_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_job_locations_link" PRIMARY KEY ("drive_id", "job_location_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_job_locations_link_drive_id" ` +
        `ON "drive_job_locations_link" ("drive_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_profile_job_locations_link" (` +
        `"drive_profile_id" integer NOT NULL, ` +
        `"job_location_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_profile_job_locations_link" PRIMARY KEY ("drive_profile_id", "job_location_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_profile_job_locations_link_drive_profile_id" ` +
        `ON "drive_profile_job_locations_link" ("drive_profile_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_placement_categories_link" (` +
        `"drive_id" integer NOT NULL, ` +
        `"placement_category_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_placement_categories_link" PRIMARY KEY ("drive_id", "placement_category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_placement_categories_link_drive_id" ` +
        `ON "drive_placement_categories_link" ("drive_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_profile_placement_categories_link" (` +
        `"drive_profile_id" integer NOT NULL, ` +
        `"placement_category_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_profile_placement_categories_link" PRIMARY KEY ("drive_profile_id", "placement_category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_profile_placement_categories_link_drive_profile_id" ` +
        `ON "drive_profile_placement_categories_link" ("drive_profile_id")`,
    );

    // --- Foreign keys -----------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "drives" ADD CONSTRAINT "FK_drives_company_id" ` +
        `FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drives" ADD CONSTRAINT "FK_drives_offer_type_id" ` +
        `FOREIGN KEY ("offer_type_id") REFERENCES "drive_offer_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_profiles" ADD CONSTRAINT "FK_drive_profiles_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_profiles" ADD CONSTRAINT "FK_drive_profiles_designation_id" ` +
        `FOREIGN KEY ("designation_id") REFERENCES "drive_designations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_profiles" ADD CONSTRAINT "FK_drive_profiles_offer_type_id" ` +
        `FOREIGN KEY ("offer_type_id") REFERENCES "drive_offer_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_profile_attachments" ADD CONSTRAINT "FK_drive_profile_attachments_drive_profile_id" ` +
        `FOREIGN KEY ("drive_profile_id") REFERENCES "drive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_company_categories_link" ADD CONSTRAINT "FK_drive_company_categories_link_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_company_categories_link" ADD CONSTRAINT "FK_drive_company_categories_link_category_id" ` +
        `FOREIGN KEY ("category_id") REFERENCES "company_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_job_locations_link" ADD CONSTRAINT "FK_drive_job_locations_link_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_job_locations_link" ADD CONSTRAINT "FK_drive_job_locations_link_job_location_id" ` +
        `FOREIGN KEY ("job_location_id") REFERENCES "drive_job_locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_profile_job_locations_link" ADD CONSTRAINT "FK_drive_profile_job_locations_link_drive_profile_id" ` +
        `FOREIGN KEY ("drive_profile_id") REFERENCES "drive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_profile_job_locations_link" ADD CONSTRAINT "FK_drive_profile_job_locations_link_job_location_id" ` +
        `FOREIGN KEY ("job_location_id") REFERENCES "drive_job_locations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_placement_categories_link" ADD CONSTRAINT "FK_drive_placement_categories_link_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_placement_categories_link" ADD CONSTRAINT "FK_drive_placement_categories_link_placement_category_id" ` +
        `FOREIGN KEY ("placement_category_id") REFERENCES "drive_placement_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "drive_profile_placement_categories_link" ADD CONSTRAINT "FK_drive_profile_placement_categories_link_drive_profile_id" ` +
        `FOREIGN KEY ("drive_profile_id") REFERENCES "drive_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_profile_placement_categories_link" ADD CONSTRAINT "FK_drive_profile_placement_categories_link_placement_category_id" ` +
        `FOREIGN KEY ("placement_category_id") REFERENCES "drive_placement_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order — children before parents. IF EXISTS keeps the
    // revert safe even if this migration was edited in place after being applied
    // (an older revision may not have created every table dropped here).
    await queryRunner.query(
      `DROP TABLE IF EXISTS "drive_profile_placement_categories_link"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "drive_placement_categories_link"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "drive_profile_job_locations_link"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_job_locations_link"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "drive_company_categories_link"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_profile_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "drives"`);
  }
}
