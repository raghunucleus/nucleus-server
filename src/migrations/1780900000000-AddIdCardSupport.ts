import { MigrationInterface, QueryRunner } from 'typeorm';

// ID-card feature: a per-student photo reference (object-storage key) and the
// singleton institution_settings row that supplies the card header (college
// name, address, logo, affiliation codes). The settings row is seeded so the
// card has a populated header immediately; admins edit it from the admin UI.
export class AddIdCardSupport1780900000000 implements MigrationInterface {
  name = 'AddIdCardSupport1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ADD "photo_key" text`);

    await queryRunner.query(
      `CREATE TABLE "institution_settings" ("id" SERIAL NOT NULL, "name" character varying(256) NOT NULL, "short_name" character varying(64), "address_line1" character varying(256), "address_line2" character varying(256), "city" character varying(128), "state" character varying(128), "pincode" character varying(16), "logo_url" text, "affiliation_code" character varying(128), "aicte_code" character varying(128), "naac_grade" character varying(32), "card_footer_note" character varying(256), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_institution_settings_id" PRIMARY KEY ("id"))`,
    );

    // Seed the singleton row so the ID card has a header from day one.
    await queryRunner.query(
      `INSERT INTO "institution_settings" ("name", "short_name", "address_line1", "city", "state", "card_footer_note") VALUES ('Raghu Engineering College', 'REC', 'Dakamarri, Bheemunipatnam Mandal', 'Visakhapatnam', 'Andhra Pradesh', 'If found, please return to the college administration office.')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "institution_settings"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "photo_key"`);
  }
}
