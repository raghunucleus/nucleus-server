import { MigrationInterface, QueryRunner } from "typeorm";

// Replaces the attendance_group_students join table with a per-student
// student_groups table — one row per student, one column per group type
// (attendance_group_id now; fee_group_id and others later).
export class CreateStudentGroups1779840000000 implements MigrationInterface {
    name = 'CreateStudentGroups1779840000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "student_groups" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "attendance_group_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_groups_student_id" UNIQUE ("student_id"), CONSTRAINT "PK_student_groups_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_student_groups_attendance_group_id" ON "student_groups" ("attendance_group_id")`);
        // Cascade on student so a student's row goes with them. Set null on
        // the attendance group so deleting a group simply unassigns students.
        await queryRunner.query(`ALTER TABLE "student_groups" ADD CONSTRAINT "FK_student_groups_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "student_groups" ADD CONSTRAINT "FK_student_groups_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        // Carry over any memberships from the old join table (DISTINCT ON keeps
        // one group per student), then drop it.
        await queryRunner.query(`INSERT INTO "student_groups" ("student_id", "attendance_group_id") SELECT DISTINCT ON ("student_id") "student_id", "attendance_group_id" FROM "attendance_group_students" ORDER BY "student_id", "id" DESC`);
        await queryRunner.query(`DROP TABLE "attendance_group_students"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "attendance_group_students" ("id" SERIAL NOT NULL, "attendance_group_id" integer NOT NULL, "student_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_att_group_students_group_student" UNIQUE ("attendance_group_id", "student_id"), CONSTRAINT "PK_att_group_students_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_att_group_students_group_id" ON "attendance_group_students" ("attendance_group_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_att_group_students_student_id" ON "attendance_group_students" ("student_id")`);
        await queryRunner.query(`ALTER TABLE "attendance_group_students" ADD CONSTRAINT "FK_att_group_students_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_group_students" ADD CONSTRAINT "FK_att_group_students_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`INSERT INTO "attendance_group_students" ("attendance_group_id", "student_id") SELECT "attendance_group_id", "student_id" FROM "student_groups" WHERE "attendance_group_id" IS NOT NULL`);
        await queryRunner.query(`DROP TABLE "student_groups"`);
    }

}
