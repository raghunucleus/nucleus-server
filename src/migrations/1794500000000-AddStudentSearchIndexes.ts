import { MigrationInterface, QueryRunner } from 'typeorm';

// Indexes for the student query engine's hottest filter/sort paths:
// - ug_cgpa: the dominant eligibility predicate (>= range scans) and a
//   common sort.
// - current_backlogs: standard eligibility predicate (= 0 / <= n).
// - display_name: the default sort — makes first-page loads an
//   index-ordered scan instead of a top-N sort. (Does not help ILIKE
//   contains; a pg_trgm GIN index is the documented later option.)
// - (programme_id, admission_year_id): the dominant filter pair (batch)
//   and the RBAC scope shape; the leading column still serves
//   programme-only queries.
// Deliberately skipped: gender / entry_type / blood_group / boolean flags
// (too low cardinality for the planner to use) and is_active (skew).
export class AddStudentSearchIndexes1794500000000 implements MigrationInterface {
  name = 'AddStudentSearchIndexes1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_ug_cgpa" ON "students" ("ug_cgpa")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_current_backlogs" ON "students" ("current_backlogs")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_display_name" ON "students" ("display_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_students_programme_id_admission_year_id" ON "students" ("programme_id", "admission_year_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_students_programme_id_admission_year_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_students_display_name"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_students_current_backlogs"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_students_ug_cgpa"`);
  }
}
