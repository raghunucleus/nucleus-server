import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Passout years — the master list of graduating years, managed from the Company
 * Attributes screen.
 *
 * `display_year` is stored rather than computed on read so the label is stable
 * for anything that later joins against this table; the service always derives
 * it from `passout_year`, and the CHECK constraints below are the last line of
 * defence behind the zod DTO (year window) and the service (date order).
 *
 * Schema + seed live in one migration on purpose: TypeORM wraps a migration in
 * a transaction, so a bad seed rolls the table back, and `down()` dropping the
 * table reverts the seed for free.
 */
export class CreatePassoutYears1796100000000 implements MigrationInterface {
  name = 'CreatePassoutYears1796100000000';

  /** A usable starting window; more years are added from the screen. */
  private readonly seedYears = [2024, 2025, 2026, 2027, 2028, 2029, 2030];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "passout_years" (` +
        `"id" SERIAL NOT NULL, ` +
        `"passout_year" integer NOT NULL, ` +
        `"display_year" character varying(16) NOT NULL, ` +
        `"start_date" date NOT NULL, ` +
        `"end_date" date NOT NULL, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_passout_years_passout_year" UNIQUE ("passout_year"), ` +
        `CONSTRAINT "CHK_passout_years_year_range" CHECK ("passout_year" > 2000 AND "passout_year" < 2100), ` +
        `CONSTRAINT "CHK_passout_years_date_order" CHECK ("end_date" >= "start_date"), ` +
        `CONSTRAINT "PK_passout_years" PRIMARY KEY ("id"))`,
    );

    // --- Seed ---------------------------------------------------------------
    // Same derivation the service uses: 2026 → "2025-2026", 2025-01-01,
    // 2026-12-31. Inserts never touch `is_active`, which keeps the column
    // default (true): a seeded year is usable immediately.
    const values = this.seedYears
      .map((y) => `(${y}, '${y - 1}-${y}', '${y - 1}-01-01', '${y}-12-31')`)
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "passout_years" ("passout_year", "display_year", "start_date", "end_date") ` +
        `VALUES ${values} ` +
        `ON CONFLICT ON CONSTRAINT "UQ_passout_years_passout_year" DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "passout_years"`);
  }
}
