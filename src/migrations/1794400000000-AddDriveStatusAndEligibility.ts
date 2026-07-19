import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a lifecycle `status` to drives and a drive-level `drive_eligibility`
 * record (with its programmes join table).
 *
 * Additive and forward-only — the drives tables already exist (CreateDrives),
 * so this just extends them; nothing is dropped or rebuilt.
 *
 * `status` is a free-set varchar enum (draft / ready_to_publish / published /
 * archived), default 'draft'. Eligibility is 1:1 with a drive (unique
 * `drive_id`, CASCADE), its multi-value axes stored as Postgres arrays except
 * programmes, which reference the master table via `drive_eligible_programmes_link`
 * (RESTRICT on the programme, like every other lookup reference here).
 */
export class AddDriveStatusAndEligibility1794400000000 implements MigrationInterface {
  name = 'AddDriveStatusAndEligibility1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- drive status -----------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "drives" ADD COLUMN "status" character varying(16) NOT NULL DEFAULT 'draft'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drives_status" ON "drives" ("status")`,
    );

    // --- drive_eligibility (1:1 with a drive) -----------------------------
    await queryRunner.query(
      `CREATE TABLE "drive_eligibility" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_id" integer NOT NULL, ` +
        `"entry_types" smallint array NOT NULL DEFAULT '{}', ` +
        `"genders" character varying array NOT NULL DEFAULT '{}', ` +
        `"passout_years" integer array NOT NULL DEFAULT '{}', ` +
        `"allow_backlog_history" boolean NOT NULL DEFAULT false, ` +
        `"max_current_backlogs" integer, ` +
        `"min_tenth_percentage" numeric(5,2), ` +
        `"min_twelfth_or_diploma_percentage" numeric(5,2), ` +
        `"min_btech_cgpa" numeric(4,2), ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_drive_eligibility_drive_id" UNIQUE ("drive_id"), ` +
        `CONSTRAINT "PK_drive_eligibility" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" ADD CONSTRAINT "FK_drive_eligibility_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- eligible programmes join table -----------------------------------
    await queryRunner.query(
      `CREATE TABLE "drive_eligible_programmes_link" (` +
        `"drive_eligibility_id" integer NOT NULL, ` +
        `"programme_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_drive_eligible_programmes_link" PRIMARY KEY ("drive_eligibility_id", "programme_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_eligible_programmes_link_drive_eligibility_id" ` +
        `ON "drive_eligible_programmes_link" ("drive_eligibility_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligible_programmes_link" ADD CONSTRAINT "FK_drive_eligible_programmes_link_drive_eligibility_id" ` +
        `FOREIGN KEY ("drive_eligibility_id") REFERENCES "drive_eligibility"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligible_programmes_link" ADD CONSTRAINT "FK_drive_eligible_programmes_link_programme_id" ` +
        `FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "drive_eligible_programmes_link"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_eligibility"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_drives_status"`);
    await queryRunner.query(
      `ALTER TABLE "drives" DROP COLUMN IF EXISTS "status"`,
    );
  }
}
