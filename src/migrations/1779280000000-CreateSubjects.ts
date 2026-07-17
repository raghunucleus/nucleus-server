import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubjects1779280000000 implements MigrationInterface {
  name = 'CreateSubjects1779280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "subjects" ("id" SERIAL NOT NULL, "regulation_id" integer NOT NULL, "code" character varying(32) NOT NULL, "name" character varying(255) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_subjects_code" UNIQUE ("code"), CONSTRAINT "UQ_subjects_regulation_name" UNIQUE ("regulation_id", "name"), CONSTRAINT "PK_subjects_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subjects_regulation_id" ON "subjects" ("regulation_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "subjects" ADD CONSTRAINT "FK_subjects_regulation_id" FOREIGN KEY ("regulation_id") REFERENCES "regulations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subjects" DROP CONSTRAINT "FK_subjects_regulation_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_subjects_regulation_id"`);
    await queryRunner.query(`DROP TABLE "subjects"`);
  }
}
