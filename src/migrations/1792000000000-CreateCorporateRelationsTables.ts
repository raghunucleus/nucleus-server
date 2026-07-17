import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corporate-relations CRM schema (greenfield): configurable classifier lookups,
 * the companies master, the multi-select join tables that reference the
 * lookups + departments, and the CRM activity tables (contacts, interactions,
 * relationship milestones, attachments). Seeds sensible default lookup rows.
 */
export class CreateCorporateRelationsTables1792000000000 implements MigrationInterface {
  name = 'CreateCorporateRelationsTables1792000000000';

  // Configurable lookup tables — identical shape.
  private readonly lookups = [
    'company_categories',
    'company_industries',
    'company_types',
    'company_sizes',
    'company_sources',
    'company_hiring_modes',
    'company_roles',
    'company_tags',
  ];

  // Multi-select join tables: (company_id, <col>) → <ref>(id).
  private readonly links = [
    {
      table: 'company_categories_link',
      col: 'category_id',
      ref: 'company_categories',
    },
    {
      table: 'company_industries_link',
      col: 'industry_id',
      ref: 'company_industries',
    },
    { table: 'company_types_link', col: 'type_id', ref: 'company_types' },
    { table: 'company_sizes_link', col: 'size_id', ref: 'company_sizes' },
    { table: 'company_sources_link', col: 'source_id', ref: 'company_sources' },
    {
      table: 'company_hiring_modes_link',
      col: 'hiring_mode_id',
      ref: 'company_hiring_modes',
    },
    { table: 'company_roles_link', col: 'role_id', ref: 'company_roles' },
    { table: 'company_tags_link', col: 'tag_id', ref: 'company_tags' },
    {
      table: 'company_eligible_branches',
      col: 'department_id',
      ref: 'departments',
    },
  ];

  // Default seed rows per lookup.
  private readonly seeds: Record<string, string[]> = {
    company_categories: ['IT', 'Core', 'Non-core', 'Service'],
    company_industries: [
      'Information Technology',
      'Manufacturing',
      'Banking & Finance',
      'Consulting',
      'Healthcare',
      'Education',
      'E-commerce',
    ],
    company_types: [
      'Product',
      'Service',
      'MNC',
      'Startup',
      'PSU',
      'Government',
    ],
    company_sizes: ['1-50', '51-200', '201-1000', '1001-5000', '5000+'],
    company_sources: [
      'Referral',
      'Alumni',
      'Inbound',
      'Event',
      'Cold outreach',
    ],
    company_hiring_modes: ['On-campus', 'Off-campus', 'Virtual', 'Internship'],
    company_roles: [
      'SDE',
      'Analyst',
      'Trainee',
      'Consultant',
      'Research Associate',
    ],
    company_tags: [
      'Dream',
      'Super dream',
      'Mass recruiter',
      'Repeat recruiter',
    ],
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Lookup tables ----------------------------------------------------
    for (const t of this.lookups) {
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
    }

    // --- companies --------------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "companies" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(200) NOT NULL, ` +
        `"short_name" character varying(120), ` +
        `"website" character varying(255), ` +
        `"linkedin_url" character varying(255), ` +
        `"description" text, ` +
        `"logo_key" character varying(512), ` +
        `"founded_year" integer, ` +
        `"glassdoor_rating" numeric(2,1), ` +
        `"general_email" character varying(255), ` +
        `"general_phone" character varying(32), ` +
        `"ownership_type" character varying(16), ` +
        `"tier" character varying(1), ` +
        `"gstin" character varying(32), ` +
        `"cin" character varying(32), ` +
        `"pan" character varying(32), ` +
        `"registration_number" character varying(64), ` +
        `"package_min" numeric(12,2), ` +
        `"package_max" numeric(12,2), ` +
        `"offers_internships" boolean NOT NULL DEFAULT false, ` +
        `"offers_ppo" boolean NOT NULL DEFAULT false, ` +
        `"last_engaged_on" date, ` +
        `"relationship_status" character varying(16) NOT NULL DEFAULT 'prospect', ` +
        `"partnership_since" date, ` +
        `"address_line1" character varying(255), ` +
        `"address_line2" character varying(255), ` +
        `"city" character varying(120), ` +
        `"state" character varying(120), ` +
        `"country" character varying(120), ` +
        `"pincode" character varying(16), ` +
        `"responsible_employee_id" integer, ` +
        `"created_by_employee_id" integer, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_companies_name" UNIQUE ("name"), ` +
        `CONSTRAINT "PK_companies" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_companies_responsible_employee_id" ON "companies" ("responsible_employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "companies" ADD CONSTRAINT "FK_companies_responsible_employee_id" FOREIGN KEY ("responsible_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // --- Join tables ------------------------------------------------------
    for (const l of this.links) {
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

    // --- company_contacts -------------------------------------------------
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

    // --- company_interactions ---------------------------------------------
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

    // --- company_relationship_milestones ----------------------------------
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

    // --- company_attachments ----------------------------------------------
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

    // --- Seed default lookup rows -----------------------------------------
    for (const [table, names] of Object.entries(this.seeds)) {
      const values = names
        .map((n, i) => `('${n.replace(/'/g, "''")}', ${i})`)
        .join(', ');
      await queryRunner.query(
        `INSERT INTO "${table}" ("name", "sort_order") VALUES ${values}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "company_attachments"`);
    await queryRunner.query(`DROP TABLE "company_relationship_milestones"`);
    await queryRunner.query(`DROP TABLE "company_interactions"`);
    await queryRunner.query(`DROP TABLE "company_contacts"`);
    for (const l of [...this.links].reverse()) {
      await queryRunner.query(`DROP TABLE "${l.table}"`);
    }
    await queryRunner.query(`DROP TABLE "companies"`);
    for (const t of [...this.lookups].reverse()) {
      await queryRunner.query(`DROP TABLE "${t}"`);
    }
  }
}
