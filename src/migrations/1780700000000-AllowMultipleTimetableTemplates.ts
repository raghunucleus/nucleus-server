import { MigrationInterface, QueryRunner } from "typeorm";

// Pivot again: a group can save several timetable templates (e.g. "Regular
// week", "Exam week", "Industrial visit week") and the group incharge picks
// one at week-publish time. Drop the unique constraint that forced exactly
// one timetable per (programme_semester, attendance_group).
//
// publishWindow now wipes still-scheduled sessions by (group, week) so
// switching template A → template B mid-semester replaces A's rows cleanly
// instead of mixing them with B's.
export class AllowMultipleTimetableTemplates1780700000000 implements MigrationInterface {
    name = 'AllowMultipleTimetableTemplates1780700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "timetables" DROP CONSTRAINT IF EXISTS "UQ_timetables_ps_group"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Recreating the unique constraint requires deduplicating again — we
        // intentionally don't do that on revert. If a downgrade is needed,
        // operators should manually delete the extras first.
        await queryRunner.query(`ALTER TABLE "timetables" ADD CONSTRAINT "UQ_timetables_ps_group" UNIQUE ("programme_semester_id", "attendance_group_id")`);
    }

}
