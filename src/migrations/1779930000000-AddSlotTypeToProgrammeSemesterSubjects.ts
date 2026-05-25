import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSlotTypeToProgrammeSemesterSubjects1779930000000 implements MigrationInterface {
    name = 'AddSlotTypeToProgrammeSemesterSubjects1779930000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // slot_type categorises non-real-subject rows (i.e. those with a
        // placeholder_name) as one of the slot kinds students can fill later.
        // Null for real-subject rows; mandatory for slot rows. Kept as a
        // varchar + CHECK rather than a PG enum so values can be extended
        // without an ALTER TYPE migration.
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD "slot_type" character varying(16)`);

        // Backfill existing slot rows (placeholder_name set, subject_id null)
        // as 'open_elective' since that's the only kind that existed before.
        await queryRunner.query(`UPDATE "programme_semester_subjects" SET "slot_type" = 'open_elective' WHERE "subject_id" IS NULL`);

        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_slot_type_with_placeholder" CHECK ((subject_id IS NOT NULL AND slot_type IS NULL) OR (subject_id IS NULL AND slot_type IN ('open_elective', 'honors', 'minors')))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_slot_type_with_placeholder"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP COLUMN "slot_type"`);
    }

}
