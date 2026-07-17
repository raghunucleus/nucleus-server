import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmployees1779410000000 implements MigrationInterface {
  name = 'CreateEmployees1779410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "employees" ("id" SERIAL NOT NULL, "emp_code" character varying(32) NOT NULL, "emp_display_name" character varying(128) NOT NULL, "gender" character varying(16) NOT NULL, "department_id" integer NOT NULL, "designation_id" integer NOT NULL, "mobile_number" character varying(20) NOT NULL, "country_code" character varying(8) NOT NULL DEFAULT '91', "email" character varying(255) NOT NULL, "rm_emp_code" character varying(32), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_employees_emp_code" UNIQUE ("emp_code"), CONSTRAINT "UQ_employees_email" UNIQUE ("email"), CONSTRAINT "UQ_employees_country_code_mobile_number" UNIQUE ("country_code", "mobile_number"), CONSTRAINT "PK_employees_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employees_department_id" ON "employees" ("department_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employees_designation_id" ON "employees" ("designation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employees_rm_emp_code" ON "employees" ("rm_emp_code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "FK_employees_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "FK_employees_designation_id" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "FK_employees_rm_emp_code" FOREIGN KEY ("rm_emp_code") REFERENCES "employees"("emp_code") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "FK_employees_rm_emp_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "FK_employees_designation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "FK_employees_department_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_employees_rm_emp_code"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_employees_designation_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_employees_department_id"`,
    );
    await queryRunner.query(`DROP TABLE "employees"`);
  }
}
