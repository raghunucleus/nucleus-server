import { MigrationInterface, QueryRunner } from "typeorm";

// Adds the academic-calendar boundaries to programme_semesters so the
// session seeder has a real upper bound (and a daily cron can auto-flip
// the lifecycle status later). Both columns nullable so existing rows
// migrate without manual backfill — admins fill them in via the UI.
export class AddPlannedDatesToProgrammeSemesters1780500000000 implements MigrationInterface {
    name = 'AddPlannedDatesToProgrammeSemesters1780500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD "planned_start_date" date`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD "planned_end_date" date`);
        // If end is set, it must be on or after start.
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD CONSTRAINT "CHK_programme_semesters_planned_dates_order" CHECK (planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP CONSTRAINT "CHK_programme_semesters_planned_dates_order"`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP COLUMN "planned_end_date"`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP COLUMN "planned_start_date"`);
    }

}
