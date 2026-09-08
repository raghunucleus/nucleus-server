import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Student leaves — the domain record behind the student "Leaves" module. One
 * row per application; the approval lifecycle itself runs through the generic
 * `approval_requests` framework (types `leave_apply` / `leave_cancel`), and the
 * two request FKs link a leave to the request that raised it and, later, to
 * the request that asked to cancel it.
 *
 *   pending          --apply approved-->   approved
 *   pending          --apply rejected-->   rejected
 *   pending          --student withdraws--> withdrawn
 *   approved         --cancel requested--> cancel_requested
 *   cancel_requested --cancel approved-->  cancelled
 *   cancel_requested --cancel rejected / withdrawn--> approved
 *
 * `approved` and `cancel_requested` are the statuses in which a leave is IN
 * EFFECT: attendance marking pre-fills `leave` for the student on those dates,
 * and already-recorded `absent` marks in the range were flipped to `leave` at
 * approval time.
 *
 * `from_time`/`to_time` are NULL for a full-day leave. When set (single-day
 * only) the leave covers just the class sessions whose period run overlaps
 * [from_time, to_time).
 */
export class CreateStudentLeaves1797100000000 implements MigrationInterface {
  name = 'CreateStudentLeaves1797100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_leaves" (` +
        `"id" SERIAL NOT NULL, ` +
        `"student_id" integer NOT NULL, ` +
        `"leave_type_id" integer NOT NULL, ` +
        `"from_date" date NOT NULL, ` +
        `"to_date" date NOT NULL, ` +
        `"from_time" time, ` +
        `"to_time" time, ` +
        `"reason" text, ` +
        `"attachments" jsonb NOT NULL DEFAULT '[]', ` +
        `"status" character varying(24) NOT NULL DEFAULT 'pending', ` +
        `"apply_request_id" integer, ` +
        `"cancel_request_id" integer, ` +
        `"decided_at" TIMESTAMP WITH TIME ZONE, ` +
        `"decided_by_employee_id" integer, ` +
        `"cancelled_at" TIMESTAMP WITH TIME ZONE, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "CHK_student_leaves_date_range" CHECK ("to_date" >= "from_date"), ` +
        `CONSTRAINT "CHK_student_leaves_partial_window" CHECK (` +
        `("from_time" IS NULL) = ("to_time" IS NULL) ` +
        `AND ("from_time" IS NULL OR ("to_time" > "from_time" AND "from_date" = "to_date"))), ` +
        `CONSTRAINT "CHK_student_leaves_status" CHECK ("status" IN ('pending','approved','rejected','withdrawn','cancel_requested','cancelled')), ` +
        `CONSTRAINT "PK_student_leaves_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_leaves_student_id_status" ON "student_leaves" ("student_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_leaves_from_date_to_date" ON "student_leaves" ("from_date", "to_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_leaves_apply_request_id" ON "student_leaves" ("apply_request_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_leaves_cancel_request_id" ON "student_leaves" ("cancel_request_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" ADD CONSTRAINT "FK_student_leaves_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" ADD CONSTRAINT "FK_student_leaves_leave_type_id" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" ADD CONSTRAINT "FK_student_leaves_apply_request_id" FOREIGN KEY ("apply_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" ADD CONSTRAINT "FK_student_leaves_cancel_request_id" FOREIGN KEY ("cancel_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" ADD CONSTRAINT "FK_student_leaves_decided_by_employee_id" FOREIGN KEY ("decided_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_leaves" DROP CONSTRAINT "FK_student_leaves_decided_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" DROP CONSTRAINT "FK_student_leaves_cancel_request_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" DROP CONSTRAINT "FK_student_leaves_apply_request_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" DROP CONSTRAINT "FK_student_leaves_leave_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_leaves" DROP CONSTRAINT "FK_student_leaves_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_student_leaves_cancel_request_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_student_leaves_apply_request_id"`);
    await queryRunner.query(
      `DROP INDEX "IDX_student_leaves_from_date_to_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_student_leaves_student_id_status"`,
    );
    await queryRunner.query(`DROP TABLE "student_leaves"`);
  }
}
