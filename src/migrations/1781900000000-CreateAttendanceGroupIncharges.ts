import { MigrationInterface, QueryRunner } from "typeorm";

// Moves attendance-group in-charge from a single column on `attendance_groups`
// to a `attendance_group_incharges` join table so a group can have several
// in-charges. Existing single in-charges are carried over before the old
// column is dropped.
export class CreateAttendanceGroupIncharges1781900000000 implements MigrationInterface {
    name = 'CreateAttendanceGroupIncharges1781900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "attendance_group_incharges" ("id" SERIAL NOT NULL, "attendance_group_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_att_group_incharges_group_employee" UNIQUE ("attendance_group_id", "employee_id"), CONSTRAINT "PK_attendance_group_incharges_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_att_group_incharges_employee_id" ON "attendance_group_incharges" ("employee_id")`);
        await queryRunner.query(`ALTER TABLE "attendance_group_incharges" ADD CONSTRAINT "FK_att_group_incharges_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_group_incharges" ADD CONSTRAINT "FK_att_group_incharges_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // Carry existing single in-charges into the join table.
        await queryRunner.query(`INSERT INTO "attendance_group_incharges" ("attendance_group_id", "employee_id") SELECT "id", "group_incharge_employee_id" FROM "attendance_groups" WHERE "group_incharge_employee_id" IS NOT NULL`);

        // Retire the old single-incharge column.
        await queryRunner.query(`ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_group_incharge_employee_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_att_groups_group_incharge_employee_id"`);
        await queryRunner.query(`ALTER TABLE "attendance_groups" DROP COLUMN "group_incharge_employee_id"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore the single-incharge column and its index/FK.
        await queryRunner.query(`ALTER TABLE "attendance_groups" ADD "group_incharge_employee_id" integer`);
        await queryRunner.query(`CREATE INDEX "IDX_att_groups_group_incharge_employee_id" ON "attendance_groups" ("group_incharge_employee_id")`);
        await queryRunner.query(`ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_group_incharge_employee_id" FOREIGN KEY ("group_incharge_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        // Collapse each group's in-charges back to a single one (lowest employee id).
        await queryRunner.query(`UPDATE "attendance_groups" g SET "group_incharge_employee_id" = (SELECT i."employee_id" FROM "attendance_group_incharges" i WHERE i."attendance_group_id" = g."id" ORDER BY i."employee_id" ASC LIMIT 1)`);

        await queryRunner.query(`ALTER TABLE "attendance_group_incharges" DROP CONSTRAINT "FK_att_group_incharges_employee_id"`);
        await queryRunner.query(`ALTER TABLE "attendance_group_incharges" DROP CONSTRAINT "FK_att_group_incharges_attendance_group_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_att_group_incharges_employee_id"`);
        await queryRunner.query(`DROP TABLE "attendance_group_incharges"`);
    }

}
