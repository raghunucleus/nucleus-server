import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHodToDepartments1779960000000 implements MigrationInterface {
    name = 'AddHodToDepartments1779960000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "departments" ADD "hod_employee_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_departments_hod_employee_id" ON "departments" ("hod_employee_id")`);
        await queryRunner.query(`ALTER TABLE "departments" ADD CONSTRAINT "FK_departments_hod_employee_id" FOREIGN KEY ("hod_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "departments" DROP CONSTRAINT "FK_departments_hod_employee_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_departments_hod_employee_id"`);
        await queryRunner.query(`ALTER TABLE "departments" DROP COLUMN "hod_employee_id"`);
    }

}
