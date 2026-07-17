import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the `programme_admission_year_profile_verifiers` join table so a
// (programme × admission-year) batch can have several profile verifiers —
// employees who verify the details of that batch's students. Mirrors the
// attendance_group_incharges shape: named constraints, CASCADE FKs, an index
// on employee_id.
export class CreateProgrammeAdmissionYearProfileVerifiers1792200000000 implements MigrationInterface {
  name = 'CreateProgrammeAdmissionYearProfileVerifiers1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "programme_admission_year_profile_verifiers" ("id" SERIAL NOT NULL, "programme_admission_year_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pay_profile_verifiers_pay_employee" UNIQUE ("programme_admission_year_id", "employee_id"), CONSTRAINT "PK_pay_profile_verifiers_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pay_profile_verifiers_employee_id" ON "programme_admission_year_profile_verifiers" ("employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_admission_year_profile_verifiers" ADD CONSTRAINT "FK_pay_profile_verifiers_pay_id" FOREIGN KEY ("programme_admission_year_id") REFERENCES "programme_admission_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_admission_year_profile_verifiers" ADD CONSTRAINT "FK_pay_profile_verifiers_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_admission_year_profile_verifiers" DROP CONSTRAINT "FK_pay_profile_verifiers_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_admission_year_profile_verifiers" DROP CONSTRAINT "FK_pay_profile_verifiers_pay_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pay_profile_verifiers_employee_id"`,
    );
    await queryRunner.query(
      `DROP TABLE "programme_admission_year_profile_verifiers"`,
    );
  }
}
