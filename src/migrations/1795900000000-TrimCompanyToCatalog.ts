import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strips the corporate-relations company record back to a plain catalog entry:
 * name, URL, logo, category, plus an approval flag and a tri-state active flag.
 *
 * Everything else goes — 27 columns on `companies`, seven of the eight
 * classifier lookups (category survives because drive-management tags drives
 * against the same master via `drive_company_categories_link`), the eligible-
 * branches link, and the entire CRM side (contacts, interactions, relationship
 * milestones, attachments, activity log).
 *
 * DESTRUCTIVE. `down()` restores the STRUCTURE only — every row in the dropped
 * tables and columns is unrecoverable. Take a `pg_dump` of `companies`,
 * `company_contacts`, `company_interactions`, `company_relationship_milestones`
 * and `company_activity_log` before running this.
 *
 * Existing rows are grandfathered as approved (`is_approved = true`) with their
 * `is_active` left exactly as it was, so today's catalog keeps working. New
 * companies insert with `is_active` NULL = awaiting approval.
 */
export class TrimCompanyToCatalog1795900000000 implements MigrationInterface {
  name = 'TrimCompanyToCatalog1795900000000';

  // Lookup tables dropped (company_categories survives).
  private readonly droppedLookups = [
    'company_industries',
    'company_types',
    'company_sizes',
    'company_sources',
    'company_hiring_modes',
    'company_roles',
    'company_tags',
  ];

  // Join tables dropped (company_categories_link survives).
  private readonly droppedLinks = [
    { table: 'company_industries_link', col: 'industry_id', ref: 'company_industries' },
    { table: 'company_types_link', col: 'type_id', ref: 'company_types' },
    { table: 'company_sizes_link', col: 'size_id', ref: 'company_sizes' },
    { table: 'company_sources_link', col: 'source_id', ref: 'company_sources' },
    { table: 'company_hiring_modes_link', col: 'hiring_mode_id', ref: 'company_hiring_modes' },
    { table: 'company_roles_link', col: 'role_id', ref: 'company_roles' },
    { table: 'company_tags_link', col: 'tag_id', ref: 'company_tags' },
    { table: 'company_eligible_branches', col: 'department_id', ref: 'departments' },
  ];

  // Columns dropped from `companies`, with the DDL needed to put them back.
  private readonly droppedColumns: [string, string][] = [
    ['short_name', 'character varying(120)'],
    ['linkedin_url', 'character varying(255)'],
    ['description', 'text'],
    ['founded_year', 'integer'],
    ['glassdoor_rating', 'numeric(2,1)'],
    ['general_email', 'character varying(255)'],
    ['general_phone', 'character varying(32)'],
    ['ownership_type', 'character varying(16)'],
    ['tier', 'character varying(1)'],
    ['gstin', 'character varying(32)'],
    ['cin', 'character varying(32)'],
    ['pan', 'character varying(32)'],
    ['registration_number', 'character varying(64)'],
    ['package_min', 'numeric(12,2)'],
    ['package_max', 'numeric(12,2)'],
    ['offers_internships', 'boolean NOT NULL DEFAULT false'],
    ['offers_ppo', 'boolean NOT NULL DEFAULT false'],
    ['last_engaged_on', 'date'],
    ['relationship_status', "character varying(16) NOT NULL DEFAULT 'prospect'"],
    ['partnership_since', 'date'],
    ['address_line1', 'character varying(255)'],
    ['address_line2', 'character varying(255)'],
    ['city', 'character varying(120)'],
    ['state', 'character varying(120)'],
    ['country', 'character varying(120)'],
    ['pincode', 'character varying(16)'],
    ['responsible_employee_id', 'integer'],
  ];

  // Seed rows for the dropped lookups, restored by down() so the recreated
  // tables match what 1792000000000 originally inserted.
  private readonly seeds: Record<string, string[]> = {
    company_industries: [
      'Information Technology',
      'Manufacturing',
      'Banking & Finance',
      'Consulting',
      'Healthcare',
      'Education',
      'E-commerce',
    ],
    company_types: ['Product', 'Service', 'MNC', 'Startup', 'PSU', 'Government'],
    company_sizes: ['1-50', '51-200', '201-1000', '1001-5000', '5000+'],
    company_sources: ['Referral', 'Alumni', 'Inbound', 'Event', 'Cold outreach'],
    company_hiring_modes: ['On-campus', 'Off-campus', 'Virtual', 'Internship'],
    company_roles: ['SDE', 'Analyst', 'Trainee', 'Consultant', 'Research Associate'],
    company_tags: ['Dream', 'Super dream', 'Mass recruiter', 'Repeat recruiter'],
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- RBAC rows first --------------------------------------------------
    // `corporate_relations.companies.view` and the `assign` action are gone
    // from the catalog. Reads tolerate the drift (unknown keys are skipped),
    // but RbacAdminService.validateScreens rejects an unknown action on save —
    // leaving these behind makes every placement role un-editable in the admin
    // UI. `role_screens.allowed_actions` is jsonb; never leave it empty.
    await queryRunner.query(
      `DELETE FROM "role_assignment_attributes" WHERE "screen_key" = 'corporate_relations.companies.view'`,
    );
    await queryRunner.query(
      `DELETE FROM "role_screens" WHERE "screen_key" = 'corporate_relations.companies.view'`,
    );
    await queryRunner.query(
      `UPDATE "role_screens" SET "allowed_actions" = COALESCE(` +
        `(SELECT jsonb_agg(a) FROM jsonb_array_elements_text("allowed_actions") t(a) WHERE a <> 'assign'), ` +
        `'["view"]'::jsonb) ` +
        `WHERE "screen_key" = 'corporate_relations.company_management.manage' ` +
        `AND "allowed_actions" ? 'assign'`,
    );

    // --- CRM tables, children before parents ------------------------------
    await queryRunner.query(`DROP TABLE IF EXISTS "company_attachments"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "company_relationship_milestones"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "company_interactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "company_contacts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "company_activity_log"`);

    // --- Join tables before the lookups they reference ---------------------
    for (const l of this.droppedLinks) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${l.table}"`);
    }
    for (const t of this.droppedLookups) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${t}"`);
    }

    // --- Approval flag; grandfather everything that already exists ---------
    await queryRunner.query(
      `ALTER TABLE "companies" ADD "is_approved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`UPDATE "companies" SET "is_approved" = true`);

    // --- is_active becomes the tri-state (NULL = awaiting approval) --------
    await queryRunner.query(
      `ALTER TABLE "companies" ALTER COLUMN "is_active" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ALTER COLUMN "is_active" DROP NOT NULL`,
    );

    // --- Officer FK/index, then the columns themselves ---------------------
    await queryRunner.query(
      `ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "FK_companies_responsible_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_companies_responsible_employee_id"`,
    );
    for (const [col] of this.droppedColumns) {
      await queryRunner.query(
        `ALTER TABLE "companies" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }

  /**
   * Structure-only restore — see the class docblock. Rebuilt tables come back
   * empty; rebuilt columns come back NULL (or at their original default).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    // --- companies columns -------------------------------------------------
    for (const [col, type] of this.droppedColumns) {
      await queryRunner.query(
        `ALTER TABLE "companies" ADD "${col}" ${type}`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX "IDX_companies_responsible_employee_id" ON "companies" ("responsible_employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD CONSTRAINT "FK_companies_responsible_employee_id" FOREIGN KEY ("responsible_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Awaiting-approval rows have no pre-trim equivalent — treat them as
    // active so the NOT NULL constraint can go back on.
    await queryRunner.query(
      `UPDATE "companies" SET "is_active" = true WHERE "is_active" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ALTER COLUMN "is_active" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ALTER COLUMN "is_active" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" DROP COLUMN "is_approved"`,
    );

    // --- Lookup tables + their seeds ---------------------------------------
    for (const t of this.droppedLookups) {
      await queryRunner.query(
        `CREATE TABLE "${t}" (` +
          `"id" SERIAL NOT NULL, ` +
          `"name" character varying(128) NOT NULL, ` +
          `"is_active" boolean NOT NULL DEFAULT true, ` +
          `"sort_order" integer NOT NULL DEFAULT 0, ` +
          `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
          `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
          `CONSTRAINT "UQ_${t}_name" UNIQUE ("name"), ` +
          `CONSTRAINT "PK_${t}" PRIMARY KEY ("id"))`,
      );
      const names = this.seeds[t];
      const values = names
        .map((n, i) => `('${n.replace(/'/g, "''")}', ${i})`)
        .join(', ');
      await queryRunner.query(
        `INSERT INTO "${t}" ("name", "sort_order") VALUES ${values}`,
      );
    }

    // --- Join tables -------------------------------------------------------
    for (const l of this.droppedLinks) {
      await queryRunner.query(
        `CREATE TABLE "${l.table}" (` +
          `"company_id" integer NOT NULL, ` +
          `"${l.col}" integer NOT NULL, ` +
          `CONSTRAINT "PK_${l.table}" PRIMARY KEY ("company_id", "${l.col}"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_${l.table}_${l.col}" ON "${l.table}" ("${l.col}")`,
      );
      await queryRunner.query(
        `ALTER TABLE "${l.table}" ADD CONSTRAINT "FK_${l.table}_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "${l.table}" ADD CONSTRAINT "FK_${l.table}_${l.col}" FOREIGN KEY ("${l.col}") REFERENCES "${l.ref}"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }

    // --- company_contacts --------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_contacts" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"name" character varying(160) NOT NULL, ` +
        `"designation" character varying(160), ` +
        `"email" character varying(255), ` +
        `"phone" character varying(32), ` +
        `"linkedin_url" character varying(255), ` +
        `"is_primary" boolean NOT NULL DEFAULT false, ` +
        `"notes" text, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_contacts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_contacts_company_id" ON "company_contacts" ("company_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_contacts" ADD CONSTRAINT "FK_company_contacts_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- company_interactions ----------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_interactions" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"employee_id" integer NOT NULL, ` +
        `"type" character varying(16) NOT NULL, ` +
        `"interaction_date" date NOT NULL, ` +
        `"contact_id" integer, ` +
        `"summary" text NOT NULL, ` +
        `"follow_up_date" date, ` +
        `"outcome" character varying(255), ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_interactions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_interactions_company_id" ON "company_interactions" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_interactions_company_id_date" ON "company_interactions" ("company_id", "interaction_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_interactions" ADD CONSTRAINT "FK_company_interactions_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_interactions" ADD CONSTRAINT "FK_company_interactions_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_interactions" ADD CONSTRAINT "FK_company_interactions_contact_id" FOREIGN KEY ("contact_id") REFERENCES "company_contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // --- company_relationship_milestones -----------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_relationship_milestones" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"employee_id" integer NOT NULL, ` +
        `"milestone_date" date NOT NULL, ` +
        `"type" character varying(16) NOT NULL, ` +
        `"title" character varying(200) NOT NULL, ` +
        `"summary" text, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_relationship_milestones" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_rel_milestones_company_id" ON "company_relationship_milestones" ("company_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_relationship_milestones" ADD CONSTRAINT "FK_company_rel_milestones_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_relationship_milestones" ADD CONSTRAINT "FK_company_rel_milestones_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- company_attachments ------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_attachments" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"interaction_id" integer, ` +
        `"milestone_id" integer, ` +
        `"file_key" character varying(512) NOT NULL, ` +
        `"file_name" character varying(255) NOT NULL, ` +
        `"content_type" character varying(128), ` +
        `"uploaded_by" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_attachments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_attachments_company_id" ON "company_attachments" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_attachments_interaction_id" ON "company_attachments" ("interaction_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_attachments_milestone_id" ON "company_attachments" ("milestone_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_attachments" ADD CONSTRAINT "FK_company_attachments_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_attachments" ADD CONSTRAINT "FK_company_attachments_interaction_id" FOREIGN KEY ("interaction_id") REFERENCES "company_interactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_attachments" ADD CONSTRAINT "FK_company_attachments_milestone_id" FOREIGN KEY ("milestone_id") REFERENCES "company_relationship_milestones"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- company_activity_log -----------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "company_activity_log" (` +
        `"id" SERIAL NOT NULL, ` +
        `"company_id" integer NOT NULL, ` +
        `"employee_id" integer NOT NULL, ` +
        `"action" character varying(32) NOT NULL, ` +
        `"entity_type" character varying(24) NOT NULL, ` +
        `"entity_id" integer, ` +
        `"summary" text NOT NULL, ` +
        `"changes" jsonb, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_company_activity_log" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_activity_log_company_id" ON "company_activity_log" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_company_activity_log_company_id_created_at" ON "company_activity_log" ("company_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_activity_log" ADD CONSTRAINT "FK_company_activity_log_company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "company_activity_log" ADD CONSTRAINT "FK_company_activity_log_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
