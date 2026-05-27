import { MigrationInterface, QueryRunner } from "typeorm";

// One template per (programme_semester, attendance_group) carries the
// "default" flag. The Schedule view's preview modal auto-picks it so the
// admin doesn't have to choose for the common case ("Regular week").
//
// Enforced by a partial unique index: at most one row with
// is_default = TRUE per (ps, group). The service flips the bit in a
// transaction so switching default never trips the constraint.
export class AddDefaultTimetableFlag1780800000000 implements MigrationInterface {
    name = 'AddDefaultTimetableFlag1780800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "timetables" ADD "is_default" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_timetables_default_per_group" ON "timetables" ("programme_semester_id", "attendance_group_id") WHERE "is_default" = TRUE`);
        // Backfill: for every (ps, group) that has at least one template,
        // mark the oldest one as default so existing data has a sensible
        // pre-selection from day one.
        await queryRunner.query(`
            WITH ranked AS (
              SELECT
                id,
                ROW_NUMBER() OVER (
                  PARTITION BY programme_semester_id, attendance_group_id
                  ORDER BY created_at ASC, id ASC
                ) AS rn
              FROM "timetables"
            )
            UPDATE "timetables"
            SET is_default = TRUE
            WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_timetables_default_per_group"`);
        await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "is_default"`);
    }

}
