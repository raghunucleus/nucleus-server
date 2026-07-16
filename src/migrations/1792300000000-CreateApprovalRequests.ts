import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the generic `approval_requests` table — the common backbone for every
// "X needs someone's sign-off" flow (first type: student profile updates).
// The framework owns only lifecycle state; `payload` is opaque jsonb whose
// shape belongs to the request type's own module.
//
// Notes:
//  - Requester is polymorphic (student XOR employee), enforced by a CHECK, so
//    both requester FKs must be CASCADE (SET NULL would violate the CHECK).
//  - `programme_admission_year_id` is the routing scope for student requests —
//    approvers are that batch's profile verifiers.
//  - The two partial UNIQUE indexes enforce "one pending request per
//    (requester, type)" at the database level; they live only here because
//    UNIQUE constraints can't carry WHERE and the entity conventions ban
//    `@Index({ unique: true })`.
export class CreateApprovalRequests1792300000000 implements MigrationInterface {
  name = 'CreateApprovalRequests1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "approval_requests" ("id" SERIAL NOT NULL, "request_type" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "requester_student_id" integer, "requester_employee_id" integer, "payload" jsonb NOT NULL, "requester_note" text, "programme_admission_year_id" integer, "decided_by_employee_id" integer, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_note" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_approval_requests_one_requester" CHECK (num_nonnulls("requester_student_id", "requester_employee_id") = 1), CONSTRAINT "PK_approval_requests_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_requests_requester_student_id" ON "approval_requests" ("requester_student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_requests_requester_employee_id" ON "approval_requests" ("requester_employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_requests_pay_id_status" ON "approval_requests" ("programme_admission_year_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_approval_requests_pending_student_type" ON "approval_requests" ("requester_student_id", "request_type") WHERE "status" = 'pending' AND "requester_student_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_approval_requests_pending_employee_type" ON "approval_requests" ("requester_employee_id", "request_type") WHERE "status" = 'pending' AND "requester_employee_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "FK_approval_requests_requester_student_id" FOREIGN KEY ("requester_student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "FK_approval_requests_requester_employee_id" FOREIGN KEY ("requester_employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "FK_approval_requests_pay_id" FOREIGN KEY ("programme_admission_year_id") REFERENCES "programme_admission_years"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" ADD CONSTRAINT "FK_approval_requests_decided_by_employee_id" FOREIGN KEY ("decided_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "FK_approval_requests_decided_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "FK_approval_requests_pay_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "FK_approval_requests_requester_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_requests" DROP CONSTRAINT "FK_approval_requests_requester_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_approval_requests_pending_employee_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_approval_requests_pending_student_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_requests_pay_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_requests_requester_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_requests_requester_student_id"`,
    );
    await queryRunner.query(`DROP TABLE "approval_requests"`);
  }
}
