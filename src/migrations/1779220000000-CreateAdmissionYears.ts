import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdmissionYears1779220000000 implements MigrationInterface {
  name = 'CreateAdmissionYears1779220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admission_years" ("id" SERIAL NOT NULL, "year" integer NOT NULL, "display_year" character varying(32) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_admission_years_year" UNIQUE ("year"), CONSTRAINT "PK_admission_years_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "admission_years"`);
  }
}
