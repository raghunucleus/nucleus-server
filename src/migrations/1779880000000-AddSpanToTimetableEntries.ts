import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds `span` to timetable_entries — how many consecutive periods a class
// occupies on its day. 1 is a normal single-period class; >1 merges periods
// (e.g. a two-period lab on Monday). The entry stays anchored at its first
// period; span counts forward from there.
export class AddSpanToTimetableEntries1779880000000 implements MigrationInterface {
  name = 'AddSpanToTimetableEntries1779880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD COLUMN "span" smallint NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP COLUMN "span"`,
    );
  }
}
