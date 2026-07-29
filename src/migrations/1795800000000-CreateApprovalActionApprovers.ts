import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates `approval_action_approvers` — the generic "who signs off on this kind
// of action" table. `action_key` references the static catalog in
// src/approval-approvers/approval-actions.ts, deliberately NOT an FK to a
// lookup table: the catalog is code, so adding an action needs no migration and
// no seed row that could drift from the keys the code references.
//
// Two indexes, both earning their keep:
//   - UQ (action_key, employee_id) enforces no-duplicate-approver AND serves
//     the hot read "who approves action X" via its leftmost prefix, so a
//     separate action_key index would be dead weight.
//   - IDX (employee_id) serves the reverse lookup "which actions can this
//     employee approve" plus the CASCADE on employee delete.
//
// `level` is reserved for future sequential approval chains; the pool is flat
// today and nothing reads it. Scoping (per department/programme) is likewise
// future work — adding it means nullable scope columns plus a pair of PARTIAL
// uniques, since Postgres treats NULLs as distinct and a plain 4-column unique
// would silently allow duplicate global rows.
export class CreateApprovalActionApprovers1795800000000 implements MigrationInterface {
  name = 'CreateApprovalActionApprovers1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "approval_action_approvers" ("id" SERIAL NOT NULL, "action_key" character varying(64) NOT NULL, "employee_id" integer NOT NULL, "level" smallint NOT NULL DEFAULT 1, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_approval_action_approvers_action_employee" UNIQUE ("action_key", "employee_id"), CONSTRAINT "PK_approval_action_approvers_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_action_approvers_employee_id" ON "approval_action_approvers" ("employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_action_approvers" ADD CONSTRAINT "FK_approval_action_approvers_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_action_approvers" DROP CONSTRAINT "FK_approval_action_approvers_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_action_approvers_employee_id"`,
    );
    await queryRunner.query(`DROP TABLE "approval_action_approvers"`);
  }
}
