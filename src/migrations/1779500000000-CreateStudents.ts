import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudents1779500000000 implements MigrationInterface {
  name = 'CreateStudents1779500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "students" ("id" SERIAL NOT NULL, "student_id" character varying(32) NOT NULL, "programme_id" integer NOT NULL, "admission_year_id" integer NOT NULL, "display_name" character varying(128) NOT NULL, "gender" character varying(16) NOT NULL, "dob" date, "blood_group" character varying(8), "abc_id" character varying(16), "mobile_number" character varying(16) NOT NULL, "email" character varying(255) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_students_student_id" UNIQUE ("student_id"), CONSTRAINT "UQ_students_email" UNIQUE ("email"), CONSTRAINT "UQ_students_abc_id" UNIQUE ("abc_id"), CONSTRAINT "PK_students_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_students_programme_id" ON "students" ("programme_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_students_admission_year_id" ON "students" ("admission_year_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_students_mobile_number" ON "students" ("mobile_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "FK_students_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "FK_students_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT "FK_students_admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT "FK_students_programme_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_students_mobile_number"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_students_admission_year_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_students_programme_id"`);
    await queryRunner.query(`DROP TABLE "students"`);
  }
}
