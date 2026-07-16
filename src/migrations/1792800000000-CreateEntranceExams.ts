import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates `entrance_exams` — an admin-managed master list of the entrance exams
// a student may have sat (AP EAPCET, AP ECET, …) surfaced under Additional
// Attributes → Student attributes, and seeds it with the two AP exams the
// college currently admits through.
//
// Master list only: nothing references it yet, so there are no FKs in or out.
// `code` is stored already-uppercased by the DTO, so plain UNIQUE is enough —
// the service additionally pre-checks case-insensitively.
//
// Codes use an underscore (AP_EAPCET) rather than the official space (AP EAPCET)
// to satisfy the /^[A-Z0-9._-]+$/ code regex every lookup in this codebase
// shares. The unabbreviated name carries the official spelling.
//
// Schema and seed live in one migration on purpose. TypeORM wraps a migration in
// a transaction, so a bad seed rolls the table back with it, and down() drops the
// table which reverts the seed for free.
export class CreateEntranceExams1792800000000 implements MigrationInterface {
  name = 'CreateEntranceExams1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "entrance_exams" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_entrance_exams_name" UNIQUE ("name"), CONSTRAINT "UQ_entrance_exams_code" UNIQUE ("code"), CONSTRAINT "PK_entrance_exams_id" PRIMARY KEY ("id"))`,
    );

    await this.seed(queryRunner);
  }

  private async seed(queryRunner: QueryRunner): Promise<void> {
    // Every insert upserts, so re-running against a populated DB is a no-op
    // rather than a crash.
    //
    // is_active is deliberately absent from the DO UPDATE SET list — on a re-run
    // against a live DB, resurrecting an exam an admin deliberately deactivated
    // would be silent data corruption. Only the name and description are
    // upserted.
    //
    // The table carries two UNIQUE constraints but Postgres allows only one
    // ON CONFLICT target. A pre-existing row matching on name but not code will
    // therefore abort the migration rather than upsert — the correct loud
    // failure for a genuine data conflict.
    for (const exam of ENTRANCE_EXAM_SEED) {
      await queryRunner.query(
        `INSERT INTO "entrance_exams" ("name", "code", "description")
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT "UQ_entrance_exams_code"
         DO UPDATE SET "name" = EXCLUDED."name",
                       "description" = EXCLUDED."description",
                       "updated_at" = now()`,
        [exam.name, exam.code, exam.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "entrance_exams"`);
  }
}

const ENTRANCE_EXAM_SEED: Array<{
  code: string;
  name: string;
  description: string;
}> = [
  {
    code: 'AP_EAPCET',
    name: 'Andhra Pradesh Engineering, Agriculture and Pharmacy Common Entrance Test',
    description: 'For first-year B.Tech admissions',
  },
  {
    code: 'AP_ECET',
    name: 'Andhra Pradesh Engineering Common Entrance Test',
    description: 'For Diploma/B.Sc. lateral entry to 2nd year B.Tech',
  },
];
