import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudentCredentials1779600000000 implements MigrationInterface {
  name = 'CreateStudentCredentials1779600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_credentials" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "password_hash" character varying(255), "must_change_password" boolean NOT NULL DEFAULT true, "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" TIMESTAMP, "last_login_at" TIMESTAMP, "last_login_ip" character varying(45), "password_changed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_credentials_student_id" UNIQUE ("student_id"), CONSTRAINT "PK_student_credentials_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_credentials" ADD CONSTRAINT "FK_student_credentials_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_credentials" DROP CONSTRAINT "FK_student_credentials_student_id"`,
    );
    await queryRunner.query(`DROP TABLE "student_credentials"`);
  }
}
