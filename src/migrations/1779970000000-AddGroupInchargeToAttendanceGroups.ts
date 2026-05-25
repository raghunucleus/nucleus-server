import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGroupInchargeToAttendanceGroups1779970000000 implements MigrationInterface {
    name = 'AddGroupInchargeToAttendanceGroups1779970000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attendance_groups" ADD "group_incharge_employee_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_att_groups_group_incharge_employee_id" ON "attendance_groups" ("group_incharge_employee_id")`);
        await queryRunner.query(`ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_group_incharge_employee_id" FOREIGN KEY ("group_incharge_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_group_incharge_employee_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_att_groups_group_incharge_employee_id"`);
        await queryRunner.query(`ALTER TABLE "attendance_groups" DROP COLUMN "group_incharge_employee_id"`);
    }

}
