import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubjectTypeMarkStructures1779910000000 implements MigrationInterface {
  name = 'CreateSubjectTypeMarkStructures1779910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "subject_type_mark_structures" ("id" SERIAL NOT NULL, "regulation_id" integer NOT NULL, "subject_type_id" integer NOT NULL, "max_marks" integer NOT NULL, "components" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_stms_regulation_subject_type" UNIQUE ("regulation_id", "subject_type_id"), CONSTRAINT "PK_subject_type_mark_structures_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "subject_type_mark_structures" ADD CONSTRAINT "FK_stms_regulation_id" FOREIGN KEY ("regulation_id") REFERENCES "regulations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subject_type_mark_structures" ADD CONSTRAINT "FK_stms_subject_type_id" FOREIGN KEY ("subject_type_id") REFERENCES "subject_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subject_type_mark_structures" DROP CONSTRAINT "FK_stms_subject_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subject_type_mark_structures" DROP CONSTRAINT "FK_stms_regulation_id"`,
    );
    await queryRunner.query(`DROP TABLE "subject_type_mark_structures"`);
  }
}
