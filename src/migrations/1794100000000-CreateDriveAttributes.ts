import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drive classifier lookups (greenfield), managed from the Drive Attributes
 * screen: designations, job locations and offer types. Seeds a starter set for
 * each — placement staff curate the rest through the UI.
 *
 * Schema + seed live in one migration on purpose: TypeORM wraps a migration in
 * a transaction, so a bad seed rolls the tables back, and `down()` dropping the
 * tables reverts the seed for free.
 *
 * `drive_offer_types` carries two extra flags so downstream drive filtering can
 * ask "is this an internship offer?" without string-matching the name.
 */
export class CreateDriveAttributes1794100000000 implements MigrationInterface {
  name = 'CreateDriveAttributes1794100000000';

  // Plain lookup tables — identical shape.
  private readonly lookups = ['drive_designations', 'drive_job_locations'];

  private readonly seeds: Record<string, string[]> = {
    drive_designations: [
      'Software Development Engineer (SDE)',
      'SDE Intern',
      'Senior Software Engineer',
      'Frontend Developer',
      'Backend Developer',
      'Full Stack Developer',
      'Mobile App Developer',
      'QA Engineer',
      'Automation Test Engineer',
      'DevOps Engineer',
      'Site Reliability Engineer',
      'Cloud Engineer',
      'Data Analyst',
      'Data Engineer',
      'Data Scientist',
      'Machine Learning Engineer',
      'Business Analyst',
      'Systems Engineer',
      'Network Engineer',
      'Cybersecurity Analyst',
      'Database Administrator',
      'Technical Support Engineer',
      'Product Manager',
      'Project Engineer',
      'Design Engineer',
      'Mechanical Engineer',
      'Civil Engineer',
      'Electrical Engineer',
      'Graduate Engineer Trainee',
      'Associate Consultant',
      'Research Analyst',
      'Technical Content Writer',
    ],
    drive_job_locations: [
      'Pan India',
      'Hyderabad',
      'Bengaluru',
      'Chennai',
      'Pune',
      'Mumbai',
      'Delhi NCR',
      'Noida',
      'Gurugram',
      'Kolkata',
      'Ahmedabad',
      'Visakhapatnam',
      'Coimbatore',
      'Kochi',
      'Thiruvananthapuram',
      'Indore',
      'Jaipur',
      'Bhubaneswar',
      'Nagpur',
      'Chandigarh',
      'Vijayawada',
      'Mysuru',
      'Lucknow',
      'Bhopal',
      'Vadodara',
      'Mangaluru',
    ],
  };

  // Offer types carry the internship / full-time flag matrix. Every row has at
  // least one flag set — an offer that is neither classifies no drive.
  private readonly offerTypes: {
    name: string;
    is_internship: boolean;
    is_full_time: boolean;
  }[] = [
    { name: 'Internship', is_internship: true, is_full_time: false },
    { name: 'Full Time', is_internship: false, is_full_time: true },
    { name: 'Internship & Full Time', is_internship: true, is_full_time: true },
    { name: 'Internship to Full Time', is_internship: true, is_full_time: true },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(
      `CREATE TABLE "drive_offer_types" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(128) NOT NULL, ` +
        `"is_internship" boolean NOT NULL DEFAULT false, ` +
        `"is_full_time" boolean NOT NULL DEFAULT false, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"sort_order" integer NOT NULL DEFAULT 0, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_drive_offer_types_name" UNIQUE ("name"), ` +
        `CONSTRAINT "PK_drive_offer_types" PRIMARY KEY ("id"))`,
    );

    // --- Seed -------------------------------------------------------------
    // `sort_order` = array index, so the curated order above is what the screen
    // renders. Inserts never touch `is_active`, which keeps the column default
    // (true): a seeded row is usable immediately.
    for (const [table, names] of Object.entries(this.seeds)) {
      const values = names
        .map((n, i) => `('${n.replace(/'/g, "''")}', ${i})`)
        .join(', ');
      await queryRunner.query(
        `INSERT INTO "${table}" ("name", "sort_order") VALUES ${values} ` +
          `ON CONFLICT ON CONSTRAINT "UQ_${table}_name" DO NOTHING`,
      );
    }

    const offerValues = this.offerTypes
      .map(
        (o, i) =>
          `('${o.name.replace(/'/g, "''")}', ${o.is_internship}, ${o.is_full_time}, ${i})`,
      )
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "drive_offer_types" ("name", "is_internship", "is_full_time", "sort_order") ` +
        `VALUES ${offerValues} ` +
        `ON CONFLICT ON CONSTRAINT "UQ_drive_offer_types_name" DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drive_offer_types"`);
    for (const t of [...this.lookups].reverse()) {
      await queryRunner.query(`DROP TABLE "${t}"`);
    }
  }
}
