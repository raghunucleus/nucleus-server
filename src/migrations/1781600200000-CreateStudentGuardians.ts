import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudentGuardians1781600200000 implements MigrationInterface {
  name = 'CreateStudentGuardians1781600200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_guardians" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "guardian_id" integer NOT NULL, "relationship" character varying(16) NOT NULL, "is_primary" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_guardians_student_id_guardian_id" UNIQUE ("student_id", "guardian_id"), CONSTRAINT "PK_student_guardians_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_guardian_id" ON "student_guardians" ("guardian_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_student_id" ON "student_guardians" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" ADD CONSTRAINT "FK_student_guardians_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" ADD CONSTRAINT "FK_student_guardians_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_guardians" DROP CONSTRAINT "FK_student_guardians_guardian_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" DROP CONSTRAINT "FK_student_guardians_student_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_student_guardians_student_id"`);
    await queryRunner.query(`DROP INDEX "IDX_student_guardians_guardian_id"`);
    await queryRunner.query(`DROP TABLE "student_guardians"`);
  }
}
