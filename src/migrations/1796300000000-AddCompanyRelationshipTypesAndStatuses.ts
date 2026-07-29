import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first two domain fields on `company_job_role_years`, plus the two lookup
 * masters behind them.
 *
 * - Relationship type — how the college engages the company for that year.
 *   MULTI-select, so a join table off the record.
 * - Current status — where the year's conversation stands. SINGLE-select, so a
 *   nullable FK column.
 *
 * Masters and fields ship together on purpose: the join table cannot exist
 * without `company_relationship_types`, and a half-applied pair is meaningless.
 * Same bundling as `CreateCorporateRelationsTables`, which creates its lookups,
 * their link tables and their seeds in one migration.
 *
 * The seeds are reference data (the option lists the Company Attributes screen
 * opens with), not demo data — hence a migration rather than a `scripts/` seeder.
 * They are re-runnable: `ON CONFLICT DO NOTHING` on the name, and the default
 * flag is only set when nothing else already holds it, so a DB whose admin has
 * since moved the default is left alone rather than tripping the partial index.
 */
export class AddCompanyRelationshipTypesAndStatuses1796300000000 implements MigrationInterface {
  name = 'AddCompanyRelationshipTypesAndStatuses1796300000000';

  /** Seeded in this order; `sort_order` is the array index. */
  private readonly relationshipTypes = [
    'Campus Hiring',
    'Off-Campus Hiring',
    'Pool Campus Hiring',
    'CoE Hiring',
    'Hackathon Hiring',
    'Social Media Hiring',
    'Contest Hiring',
    'Industry-Academia Partnership',
    'Referral Hiring',
    'Skill Based Hiring',
  ];

  /**
   * The first entry is the one flagged as the default — it is what every
   * (role, year) reads as until somebody records something else.
   */
  private readonly currentStatuses = [
    'Need to contact',
    'Discussion started',
    'Yet to start current year hiring',
    'Invitation mail sent',
    'Waiting for response',
    'Visits only NIRF',
    'Visits only Tier 1',
    'Visits only Partnered colleges',
    'Visits only CoE partnered colleges',
    'Only Skill certified hiring',
    'Only Hackathon hiring',
    'Contact later',
    'Received JD',
    'Students registration started',
    'Submitted data to company',
    'Hiring process started',
    'Result pending',
    'Hiring completed',
    'Not hiring this year',
    'Role/Requirement not suitable',
    'SPoC not reachable',
    'Black listed our college',
    'Top profile students',
    'Hiring on hold',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- masters -----------------------------------------------------------
    // Same column list as `company_categories` — they all extend
    // `CompanyLookupBase`. Only the statuses table carries `is_default`.
    await queryRunner.query(
      `CREATE TABLE "company_relationship_types" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(128) NOT NULL, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_company_relationship_types_name" UNIQUE ("name"), ` +
        `CONSTRAINT "PK_company_relationship_types" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "company_current_statuses" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(128) NOT NULL, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"is_default" boolean NOT NULL DEFAULT false, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_company_current_statuses_name" UNIQUE ("name"), ` +
        `CONSTRAINT "PK_company_current_statuses" PRIMARY KEY ("id"))`,
    );
    // At most one default across the whole table. A partial UNIQUE INDEX rather
    // than a UNIQUE CONSTRAINT because Postgres has no partial constraints —
    // the same reason `UQ_timetables_default_per_group` is an index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_current_statuses_default" ON "company_current_statuses" ("is_default") WHERE "is_default" = TRUE`,
    );

    // ---- current status on the year record ---------------------------------
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD "current_status_id" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_years_current_status_id" ON "company_job_role_years" ("current_status_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" ADD CONSTRAINT "FK_company_job_role_years_current_status_id" FOREIGN KEY ("current_status_id") REFERENCES "company_current_statuses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ---- relationship types on the year record -----------------------------
    // Constraint names abbreviate to `rel_types`; spelled out they would exceed
    // the 63-byte identifier limit and Postgres would truncate them silently,
    // breaking `down()`. Same abbreviation `FK_company_rel_milestones_company_id`
    // used. The TABLE name stays spelled out.
    await queryRunner.query(
      `CREATE TABLE "company_job_role_year_relationship_types" (` +
        `"company_job_role_year_id" integer NOT NULL, ` +
        `"relationship_type_id" integer NOT NULL, ` +
        `CONSTRAINT "PK_company_job_role_year_rel_types" PRIMARY KEY ("company_job_role_year_id", "relationship_type_id"))`,
    );
    // The PK covers lookups leading with the record; this serves the reverse
    // ("which records use this type"), which is what a deactivation check asks.
    await queryRunner.query(
      `CREATE INDEX "IDX_company_job_role_year_rel_types_relationship_type_id" ON "company_job_role_year_relationship_types" ("relationship_type_id")`,
    );
    // CASCADE on both sides, matching `company_categories_link`. The record side
    // must cascade: `company_job_role_years` itself cascades off
    // `company_job_roles`, so RESTRICT here would block deleting a job role.
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_relationship_types" ADD CONSTRAINT "FK_company_job_role_year_rel_types_company_job_role_year_id" FOREIGN KEY ("company_job_role_year_id") REFERENCES "company_job_role_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_year_relationship_types" ADD CONSTRAINT "FK_company_job_role_year_rel_types_relationship_type_id" FOREIGN KEY ("relationship_type_id") REFERENCES "company_relationship_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ---- seeds -------------------------------------------------------------
    await this.seed(
      queryRunner,
      'company_relationship_types',
      this.relationshipTypes,
    );
    await this.seed(
      queryRunner,
      'company_current_statuses',
      this.currentStatuses,
    );
    // Guarded rather than a bare UPDATE: on a re-run against a database whose
    // admin has moved the default, setting this one too would put two TRUEs in
    // the table and trip the partial index.
    await queryRunner.query(
      `UPDATE "company_current_statuses" SET "is_default" = TRUE ` +
        `WHERE "name" = $1 ` +
        `AND NOT EXISTS (SELECT 1 FROM "company_current_statuses" WHERE "is_default" = TRUE)`,
      [this.currentStatuses[0]],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Children first — the join table and the FK column both point at the
    // masters.
    await queryRunner.query(
      `DROP TABLE "company_job_role_year_relationship_types"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP CONSTRAINT "FK_company_job_role_years_current_status_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_company_job_role_years_current_status_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_job_role_years" DROP COLUMN "current_status_id"`,
    );
    await queryRunner.query(`DROP TABLE "company_current_statuses"`);
    await queryRunner.query(`DROP TABLE "company_relationship_types"`);
  }

  /** Insert the option list in order, skipping names that already exist. */
  private async seed(
    queryRunner: QueryRunner,
    table: string,
    names: string[],
  ): Promise<void> {
    const values = names
      .map((n, i) => `('${n.replace(/'/g, "''")}', ${i})`)
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "${table}" ("name", "sort_order") VALUES ${values} ON CONFLICT ("name") DO NOTHING`,
    );
  }
}
