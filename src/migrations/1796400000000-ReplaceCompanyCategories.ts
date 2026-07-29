import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces the placeholder company categories with the taxonomy the placement
 * team actually uses.
 *
 * `CreateCorporateRelationsTables` seeded four stand-ins — IT, Core, Non-core,
 * Service — to give the Company Attributes screen something to open with. This
 * swaps them for the real seven-item list.
 *
 * The delete is LOSSY: both `company_categories_link` and
 * `drive_company_categories_link` reference `company_categories` ON DELETE
 * CASCADE, so any company or drive tagged with one of the four loses that tag
 * and `down()` cannot bring it back. Only the four rows themselves are
 * restored.
 *
 * Both directions are re-runnable: the deletes are scoped by name (a database
 * whose admin has since renamed or added categories is left alone) and the
 * inserts are `ON CONFLICT DO NOTHING` on `UQ_company_categories_name`.
 */
export class ReplaceCompanyCategories1796400000000 implements MigrationInterface {
  name = 'ReplaceCompanyCategories1796400000000';

  /** Seeded in this order; `sort_order` is the array index. */
  private readonly categories = [
    'Product development',
    'IT Services',
    'ITES',
    'Core Engineering',
    'Core Engineering Sales & Service',
    'IT Product Sales & Marketing',
    'Edu-Tech',
  ];

  /** What `CreateCorporateRelationsTables` seeded, in its original order. */
  private readonly placeholders = ['IT', 'Core', 'Non-core', 'Service'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.remove(queryRunner, this.placeholders);
    await this.seed(queryRunner, this.categories);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.remove(queryRunner, this.categories);
    await this.seed(queryRunner, this.placeholders);
  }

  /** Delete by name — ids are not stable across databases. */
  private async remove(
    queryRunner: QueryRunner,
    names: string[],
  ): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "company_categories" WHERE "name" = ANY($1)`,
      [names],
    );
  }

  /** Insert the option list in order, skipping names that already exist. */
  private async seed(queryRunner: QueryRunner, names: string[]): Promise<void> {
    const values = names
      .map((n, i) => `('${n.replace(/'/g, "''")}', ${i})`)
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "company_categories" ("name", "sort_order") VALUES ${values} ` +
        `ON CONFLICT ("name") DO NOTHING`,
    );
  }
}
