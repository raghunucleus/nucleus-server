import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `student_approvals` table — the module-agnostic index of "things
 * sent to a student for a decision" plus their common core status
 * (pending/approved/rejected/sent_back/cancelled). Modules keep their own
 * granular lifecycle in their own tables and upsert the matching row here on
 * every core-status transition, keyed idempotently by (module, ref_id).
 *
 * The backfill seeds the placements module from the existing `drive_students`
 * lifecycle: invited→pending, denied→rejected, revoked→cancelled, and the
 * post-acceptance states (accepted/selected/not-selected/not-attended)→approved.
 * Imported-but-not-invited rows (status 10) are not yet sent to the student, so
 * they get no approval row.
 */
export class CreateStudentApprovals1795200000000 implements MigrationInterface {
  name = 'CreateStudentApprovals1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_approvals" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "module" character varying(32) NOT NULL, "type" character varying(32) NOT NULL, "ref_id" integer NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "decided_at" TIMESTAMP WITH TIME ZONE, "reason" character varying(512), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_approvals_module_ref" UNIQUE ("module", "ref_id"), CONSTRAINT "PK_student_approvals_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_approvals_student_id_status" ON "student_approvals" ("student_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_approvals" ADD CONSTRAINT "FK_student_approvals_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Backfill the placements module from the existing drive lifecycle.
    await queryRunner.query(
      `INSERT INTO "student_approvals"
         ("student_id", "module", "type", "ref_id", "status", "decided_at", "reason", "created_at", "updated_at")
       SELECT ds."student_id", 'placements', 'drive_invite', ds."id",
         CASE ds."status"
           WHEN 20 THEN 'pending'
           WHEN 40 THEN 'rejected'
           WHEN 80 THEN 'cancelled'
           ELSE 'approved'
         END,
         CASE WHEN ds."status" = 20 THEN NULL
              ELSE COALESCE(ds."revoked_at", ds."responded_at", ds."outcome_marked_at")
         END,
         ds."rejection_reason",
         ds."imported_at", now()
       FROM "drive_students" ds
       WHERE ds."status" >= 20`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_approvals" DROP CONSTRAINT "FK_student_approvals_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_approvals_student_id_status"`,
    );
    await queryRunner.query(`DROP TABLE "student_approvals"`);
  }
}
