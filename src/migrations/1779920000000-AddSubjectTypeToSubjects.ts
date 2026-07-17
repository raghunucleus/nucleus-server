import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the mandatory subject_type_id FK to subjects.
// Existing rows are backfilled with the lowest-id subject_type (or a seeded
// 'THEORY' row if no subject_types exist yet). Review backfilled rows
// afterwards — pick the right type per subject from the admin UI.
export class AddSubjectTypeToSubjects1779920000000 implements MigrationInterface {
  name = 'AddSubjectTypeToSubjects1779920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add as nullable so backfill can populate without violating NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "subjects" ADD COLUMN "subject_type_id" integer`,
    );

    // 2. If there are existing subjects, backfill them.
    const subjectCountRows: { count: string }[] = await queryRunner.query(
      `SELECT COUNT(*)::text AS count FROM "subjects"`,
    );
    const hasSubjects = Number(subjectCountRows[0]?.count ?? '0') > 0;

    if (hasSubjects) {
      let backfillId: number;
      const existingTypes: { id: number }[] = await queryRunner.query(
        `SELECT "id" FROM "subject_types" ORDER BY "id" ASC LIMIT 1`,
      );
      if (existingTypes.length > 0) {
        backfillId = existingTypes[0].id;
      } else {
        const inserted: { id: number }[] = await queryRunner.query(
          `INSERT INTO "subject_types" ("name", "code", "is_active") VALUES ('Theory', 'THEORY', TRUE) RETURNING "id"`,
        );
        backfillId = inserted[0].id;
      }
      await queryRunner.query(
        `UPDATE "subjects" SET "subject_type_id" = $1 WHERE "subject_type_id" IS NULL`,
        [backfillId],
      );
    }

    // 3. Now lock it down.
    await queryRunner.query(
      `ALTER TABLE "subjects" ALTER COLUMN "subject_type_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subjects" ADD CONSTRAINT "FK_subjects_subject_type_id" FOREIGN KEY ("subject_type_id") REFERENCES "subject_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subjects" DROP CONSTRAINT "FK_subjects_subject_type_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subjects" DROP COLUMN "subject_type_id"`,
    );
  }
}
