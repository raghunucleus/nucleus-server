import { MigrationInterface, QueryRunner } from 'typeorm';

// A student can be RE-ADMITTED into another programme (B.Tech → M.Tech) — the
// same person then exists as two student rows, same Aadhaar. So Aadhaar
// uniqueness is per (programme, aadhaar), not global — the same rationale
// that already keeps mobile_number non-unique. NULL aadhaars never collide
// under a composite UNIQUE either.
export class ScopeAadhaarUniquePerProgramme1793500000000 implements MigrationInterface {
  name = 'ScopeAadhaarUniquePerProgramme1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "UQ_students_aadhaar_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_students_programme_id_aadhaar_number" UNIQUE ("programme_id", "aadhaar_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "UQ_students_programme_id_aadhaar_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_students_aadhaar_number" UNIQUE ("aadhaar_number")`,
    );
  }
}
