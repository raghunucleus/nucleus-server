import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProgrammeSemesterSubjectOptions1779330000000 implements MigrationInterface {
  name = 'CreateProgrammeSemesterSubjectOptions1779330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "programme_semester_subject_options" ("id" SERIAL NOT NULL, "programme_semester_subject_id" integer NOT NULL, "subject_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pss_options_entry_subject" UNIQUE ("programme_semester_subject_id", "subject_id"), CONSTRAINT "PK_pss_options_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_options_entry_id" ON "programme_semester_subject_options" ("programme_semester_subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_options_subject_id" ON "programme_semester_subject_options" ("subject_id")`,
    );
    // Cascade on the parent entry so removing the slot cleans up its
    // candidate pool. Restrict on subject so a subject in use can't be
    // hard-deleted (it can still be deactivated).
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_options" ADD CONSTRAINT "FK_pss_options_entry_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_options" ADD CONSTRAINT "FK_pss_options_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_options" DROP CONSTRAINT "FK_pss_options_subject_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_options" DROP CONSTRAINT "FK_pss_options_entry_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_pss_options_subject_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_pss_options_entry_id"`);
    await queryRunner.query(`DROP TABLE "programme_semester_subject_options"`);
  }
}
