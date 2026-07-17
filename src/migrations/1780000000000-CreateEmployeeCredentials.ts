import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmployeeCredentials1780000000000 implements MigrationInterface {
  name = 'CreateEmployeeCredentials1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "employee_credentials" ("id" SERIAL NOT NULL, "employee_id" integer NOT NULL, "password_hash" character varying(255), "google_id" character varying(64), "must_change_password" boolean NOT NULL DEFAULT true, "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" TIMESTAMP, "last_login_at" TIMESTAMP, "last_login_ip" character varying(45), "password_changed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_employee_credentials_employee_id" UNIQUE ("employee_id"), CONSTRAINT "UQ_employee_credentials_google_id" UNIQUE ("google_id"), CONSTRAINT "PK_employee_credentials_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_credentials" ADD CONSTRAINT "FK_employee_credentials_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employee_credentials" DROP CONSTRAINT "FK_employee_credentials_employee_id"`,
    );
    await queryRunner.query(`DROP TABLE "employee_credentials"`);
  }
}
