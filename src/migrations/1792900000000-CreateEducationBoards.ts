import { MigrationInterface, QueryRunner } from 'typeorm';
import { BoardSeed, EDUCATION_BOARDS } from './seed-data/education-boards.seed';

// Creates the three education-board master lists — school_boards_x,
// school_boards_xii, diploma_boards — surfaced under Additional Attributes ->
// Student attributes, and seeds them with the Indian boards. See
// seed-data/education-boards.seed.ts for provenance and for why most rows seed
// inactive.
//
// Master lists only: nothing references them yet, so there are no FKs in or out.
// The student-profile columns that will point at these come later.
//
// Three tables rather than one with a level discriminator: most boards issue both
// a Class X and a Class XII certificate — CISCE conducts ICSE at X and ISC at XII
// — so the same code has to exist in two lists with different descriptions, which
// a shared table under UQ(code) could not express.
//
// `code` is stored already-uppercased by the DTO, so plain UNIQUE is enough — the
// services additionally pre-check case-insensitively.
//
// Schema and seed live in one migration on purpose. TypeORM wraps a migration in
// a transaction, so a bad seed rolls the tables back with it, and down() drops the
// tables which reverts the seed for free.
export class CreateEducationBoards1792900000000 implements MigrationInterface {
  name = 'CreateEducationBoards1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "school_boards_x" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_school_boards_x_name" UNIQUE ("name"), CONSTRAINT "UQ_school_boards_x_code" UNIQUE ("code"), CONSTRAINT "PK_school_boards_x_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "school_boards_xii" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_school_boards_xii_name" UNIQUE ("name"), CONSTRAINT "UQ_school_boards_xii_code" UNIQUE ("code"), CONSTRAINT "PK_school_boards_xii_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "diploma_boards" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_diploma_boards_name" UNIQUE ("name"), CONSTRAINT "UQ_diploma_boards_code" UNIQUE ("code"), CONSTRAINT "PK_diploma_boards_id" PRIMARY KEY ("id"))`,
    );

    await this.seed(queryRunner);
  }

  private async seed(queryRunner: QueryRunner): Promise<void> {
    await this.seedTable(queryRunner, 'school_boards_x', EDUCATION_BOARDS.x);
    await this.seedTable(
      queryRunner,
      'school_boards_xii',
      EDUCATION_BOARDS.xii,
    );
    await this.seedTable(
      queryRunner,
      'diploma_boards',
      EDUCATION_BOARDS.diploma,
    );

    await this.assertSeeded(queryRunner);
  }

  private async seedTable(
    queryRunner: QueryRunner,
    table: string,
    boards: BoardSeed[],
  ): Promise<void> {
    // Every insert upserts, so re-running against a populated DB is a no-op
    // rather than a crash.
    //
    // is_active is written on INSERT (unlike the entrance-exams seed, which lets
    // the column default it to true) because this catalogue ships mostly dormant
    // — see education-boards.seed.ts.
    //
    // It is deliberately absent from the DO UPDATE SET list, and that matters far
    // more here than it did for entrance exams: with ~91 dormant rows, a re-run
    // that reset is_active would silently switch off every board an admin had
    // activated since. Only the name and description are upserted.
    //
    // Each table carries two UNIQUE constraints but Postgres allows only one
    // ON CONFLICT target. A pre-existing row matching on name but not code will
    // therefore abort the migration rather than upsert — the correct loud failure
    // for a genuine data conflict.
    for (const board of boards) {
      await queryRunner.query(
        `INSERT INTO "${table}" ("name", "code", "description", "is_active")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT "UQ_${table}_code"
         DO UPDATE SET "name" = EXCLUDED."name",
                       "description" = EXCLUDED."description",
                       "updated_at" = now()`,
        [board.name, board.code, board.description, board.is_active ?? false],
      );
    }
  }

  // Fail loudly inside the transaction rather than ship a half-populated
  // dropdown. A truncated or malformed seed file rolls the whole migration back.
  //
  // These are `<` and not `!==` on purpose. By the time this migration re-runs
  // against a live DB an admin may legitimately have added boards of their own,
  // so a row count ABOVE the seed's is correct and expected; only a count below
  // it means the seed file didn't fully apply. The same reasoning rules out
  // asserting the DB's active count at all — an admin activating a dormant board
  // is the intended workflow, so that number is theirs to move, not ours to
  // police. The active canary below therefore checks the seed data in memory.
  private async assertSeeded(queryRunner: QueryRunner): Promise<void> {
    const tables: Array<[string, BoardSeed[]]> = [
      ['school_boards_x', EDUCATION_BOARDS.x],
      ['school_boards_xii', EDUCATION_BOARDS.xii],
      ['diploma_boards', EDUCATION_BOARDS.diploma],
    ];

    for (const [table, boards] of tables) {
      const [{ count: total }]: Array<{ count: number }> =
        await queryRunner.query(
          `SELECT count(*)::int AS count FROM "${table}"`,
        );
      if (Number(total) < boards.length) {
        throw new Error(
          `Education boards seed: expected at least ${boards.length} rows in ${table}, found ${total}`,
        );
      }
    }

    // Catches a hand-edit that flips the catalogue's default the wrong way —
    // e.g. adding `is_active: true` to a row while copying a neighbouring one,
    // which is invisible in review and ships a 35-item dropdown to admissions.
    const expectedActive: Record<string, number> = {
      x: 3, // BSEAP, CBSE, CISCE
      xii: 3, // BIEAP, CBSE, CISCE
      diploma: 1, // SBTET_AP
    };
    for (const [key, expected] of Object.entries(expectedActive)) {
      const actual = EDUCATION_BOARDS[
        key as keyof typeof EDUCATION_BOARDS
      ].filter((b) => b.is_active).length;
      if (actual !== expected) {
        throw new Error(
          `Education boards seed: expected ${expected} active rows in the ${key} seed data, found ${actual}`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No FKs between them, so order is free.
    await queryRunner.query(`DROP TABLE "diploma_boards"`);
    await queryRunner.query(`DROP TABLE "school_boards_xii"`);
    await queryRunner.query(`DROP TABLE "school_boards_x"`);
  }
}
