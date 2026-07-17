import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Placement categories — the CTC band a drive falls in, managed from the Drive
 * Attributes screen alongside the other drive classifiers.
 *
 * The band is two numeric bounds rather than a display string, so a drive's
 * package can resolve its category by comparison instead of name-matching.
 * Bounds are min-inclusive / max-exclusive and NULL means open-ended: "<5L" is
 * (null, 5), ">10L" is (10, null).
 *
 * Schema + seed live in one migration on purpose: TypeORM wraps a migration in
 * a transaction, so a bad seed rolls the table back, and `down()` dropping the
 * table reverts the seed for free.
 */
export class CreatePlacementCategories1794200000000 implements MigrationInterface {
  name = 'CreatePlacementCategories1794200000000';

  private readonly seeds: {
    name: string;
    min_lpa: number | null;
    max_lpa: number | null;
  }[] = [
    { name: 'Standard', min_lpa: null, max_lpa: 5 },
    { name: 'Dream', min_lpa: 5, max_lpa: 10 },
    { name: 'Super Dream', min_lpa: 10, max_lpa: null },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "drive_placement_categories" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(128) NOT NULL, ` +
        `"min_lpa" numeric(6,2), ` +
        `"max_lpa" numeric(6,2), ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_drive_placement_categories_name" UNIQUE ("name"), ` +
        `CONSTRAINT "PK_drive_placement_categories" PRIMARY KEY ("id"))`,
    );

    // --- Seed -------------------------------------------------------------
    // `sort_order` = array index, so the curated order above (cheapest band
    // first) is what the screen renders. Inserts never touch `is_active`, which
    // keeps the column default (true): a seeded row is usable immediately.
    const values = this.seeds
      .map(
        (c, i) =>
          `('${c.name.replace(/'/g, "''")}', ${c.min_lpa ?? 'NULL'}, ${c.max_lpa ?? 'NULL'}, ${i})`,
      )
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "drive_placement_categories" ("name", "min_lpa", "max_lpa", "sort_order") ` +
        `VALUES ${values} ` +
        `ON CONFLICT ON CONSTRAINT "UQ_drive_placement_categories_name" DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drive_placement_categories"`);
  }
}
