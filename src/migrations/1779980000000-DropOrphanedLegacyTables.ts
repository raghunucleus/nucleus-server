import { MigrationInterface, QueryRunner } from 'typeorm';

// Defensive cleanup for tables that were superseded by later migrations:
//   - programme_regulations  -> renamed to programme_admission_years (1779420000000)
//   - attendance_group_students -> replaced by student_groups (1779840000000)
// Both should already be gone on any DB whose migrations ran to completion.
// This migration is a safety net for environments where they somehow lingered
// (manual schema edits, partial runs, restored snapshots from older schemas).
// It is intentionally not reversible — recreating empty husks of removed
// tables would be misleading.
export class DropOrphanedLegacyTables1779980000000 implements MigrationInterface {
  name = 'DropOrphanedLegacyTables1779980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "attendance_group_students" CASCADE`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "programme_regulations" CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: these tables are obsolete; reversing the cleanup would
    // resurrect schemas that no current code references.
  }
}
