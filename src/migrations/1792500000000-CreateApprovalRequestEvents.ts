import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates `approval_request_events` — the append-only history behind every
// approval request. The request row holds only its current state (`status` is
// overwritten on each transition, `decided_*` records one decision), so this
// table is the only thing that remembers the sequence of what happened.
//
// Notes:
//  - CASCADE from the request: the trail is meaningless without its request.
//  - Both actor FKs are SET NULL so history outlives a deleted student or
//    employee. That is why there is NO `num_nonnulls(...) = 1` CHECK on the
//    actor here (unlike `approval_requests`, whose CHECK forces its requester
//    FKs to CASCADE) — such a CHECK would be violated the moment an actor is
//    deleted. `actor_kind` is denormalized to survive that nulling.
//  - No status backfill: `sent_back` ships with this work, and existing rows
//    have no recorded history to reconstruct — their timelines start empty and
//    fill from the next transition on.
export class CreateApprovalRequestEvents1792500000000
  implements MigrationInterface
{
  name = 'CreateApprovalRequestEvents1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "approval_request_events" ("id" SERIAL NOT NULL, "approval_request_id" integer NOT NULL, "event" character varying(24) NOT NULL, "actor_kind" character varying(8) NOT NULL, "actor_student_id" integer, "actor_employee_id" integer, "note" text, "detail" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_approval_request_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_approval_request_events_approval_request_id" ON "approval_request_events" ("approval_request_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" ADD CONSTRAINT "FK_approval_request_events_approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" ADD CONSTRAINT "FK_approval_request_events_actor_student_id" FOREIGN KEY ("actor_student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" ADD CONSTRAINT "FK_approval_request_events_actor_employee_id" FOREIGN KEY ("actor_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" DROP CONSTRAINT "FK_approval_request_events_actor_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" DROP CONSTRAINT "FK_approval_request_events_actor_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "approval_request_events" DROP CONSTRAINT "FK_approval_request_events_approval_request_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_approval_request_events_approval_request_id"`,
    );
    await queryRunner.query(`DROP TABLE "approval_request_events"`);
  }
}
