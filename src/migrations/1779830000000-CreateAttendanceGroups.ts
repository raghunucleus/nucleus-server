import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAttendanceGroups1779830000000 implements MigrationInterface {
  name = 'CreateAttendanceGroups1779830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "attendance_groups" ("id" SERIAL NOT NULL, "programme_semester_id" integer NOT NULL, "name" character varying(64) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_att_groups_ps_name" UNIQUE ("programme_semester_id", "name"), CONSTRAINT "PK_att_groups_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_groups_programme_semester_id" ON "attendance_groups" ("programme_semester_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "attendance_group_students" ("id" SERIAL NOT NULL, "attendance_group_id" integer NOT NULL, "student_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_att_group_students_group_student" UNIQUE ("attendance_group_id", "student_id"), CONSTRAINT "PK_att_group_students_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_group_students_group_id" ON "attendance_group_students" ("attendance_group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_group_students_student_id" ON "attendance_group_students" ("student_id")`,
    );
    // Restrict on programme_semester so a semester in use can't be removed
    // out from under its groups.
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Cascade on the group so deleting a group clears its memberships.
    // Restrict on student so a student in a group can't be hard-deleted.
    await queryRunner.query(
      `ALTER TABLE "attendance_group_students" ADD CONSTRAINT "FK_att_group_students_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_group_students" ADD CONSTRAINT "FK_att_group_students_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance_group_students" DROP CONSTRAINT "FK_att_group_students_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_group_students" DROP CONSTRAINT "FK_att_group_students_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_programme_semester_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_group_students_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_group_students_group_id"`,
    );
    await queryRunner.query(`DROP TABLE "attendance_group_students"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_groups_programme_semester_id"`,
    );
    await queryRunner.query(`DROP TABLE "attendance_groups"`);
  }
}
