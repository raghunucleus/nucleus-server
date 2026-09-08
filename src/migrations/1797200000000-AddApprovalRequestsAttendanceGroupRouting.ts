import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Third routing mode for approval requests: `attendance_group_id`, decided by
 * that group's in-charges (`attendance_group_incharges`). Student leave
 * requests use it — a leave is the group in-charge's call, not the batch's
 * profile verifiers'. Nullable like the other two routing columns; a request
 * carries exactly one of them. SET NULL so decided history outlives a deleted
 * group, same as the batch FK.
 */
export class AddApprovalRequestsAttendanceGroupRouting1797200000000 implements MigrationInterface {
  name = 'AddApprovalRequestsAttendanceGroupRouting1797200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD "attendance_group_id" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_requests_attendance_group_id_status" ON "approval_requests" ("attendance_group_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "FK_approval_requests_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "FK_approval_requests_attendance_group_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_approval_requests_attendance_group_id_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP COLUMN "attendance_group_id"`,
    );
  }
}
