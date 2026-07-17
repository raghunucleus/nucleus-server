import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates `industry_certifications` — an admin-managed master list of vendor
// certifications (AWS SAA, CCNA, …) surfaced under Additional Attributes →
// Student attributes.
//
// Master list only: nothing references it yet, so there are no FKs in or out.
// `code` is stored already-uppercased by the DTO, so plain UNIQUE is enough —
// the service additionally pre-checks case-insensitively.
export class CreateIndustryCertifications1792600000000 implements MigrationInterface {
  name = 'CreateIndustryCertifications1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "industry_certifications" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "description" text, "issuing_body" character varying(128), "website" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_industry_certifications_name" UNIQUE ("name"), CONSTRAINT "UQ_industry_certifications_code" UNIQUE ("code"), CONSTRAINT "PK_industry_certifications_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "industry_certifications"`);
  }
}
