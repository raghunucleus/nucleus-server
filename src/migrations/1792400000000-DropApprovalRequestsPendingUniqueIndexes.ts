import { MigrationInterface, QueryRunner } from 'typeorm';

// Drops the "one pending request per (requester, type)" partial unique
// indexes. Product change: a requester may hold SEVERAL pending requests of
// the same type at once (e.g. profile updates for different fields) — what
// counts as a duplicate is type-specific and now enforced by the type's
// handler inside the create transaction (see RequestTypeRegistry
// assertCreatable + the advisory lock in ApprovalRequestsService).
export class DropApprovalRequestsPendingUniqueIndexes1792400000000 implements MigrationInterface {
  name = 'DropApprovalRequestsPendingUniqueIndexes1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_approval_requests_pending_student_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_approval_requests_pending_employee_type"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_approval_requests_pending_student_type" ON "approval_requests" ("requester_student_id", "request_type") WHERE "status" = 'pending' AND "requester_student_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_approval_requests_pending_employee_type" ON "approval_requests" ("requester_employee_id", "request_type") WHERE "status" = 'pending' AND "requester_employee_id" IS NOT NULL`,
    );
  }
}
