import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Leave types — the admin-managed master list a student picks from when
 * applying for leave (Sick, Medical, Personal, …). Managed from the admin
 * Masters menu like subject types; the student portal reads only active rows.
 *
 * Schema + seed live in one migration on purpose: TypeORM wraps a migration in
 * a transaction, so a bad seed rolls the table back, and `down()` dropping the
 * table reverts the seed for free. All seeds start active — this is a short,
 * universally applicable list, not a researched catalogue an admin has to
 * prune.
 */
export class CreateLeaveTypes1797000000000 implements MigrationInterface {
  name = 'CreateLeaveTypes1797000000000';

  private readonly seeds: { name: string; code: string }[] = [
    { name: 'Sick Leave', code: 'SICK' },
    { name: 'Medical Leave', code: 'MEDICAL' },
    { name: 'Personal', code: 'PERSONAL' },
    { name: 'Family Function', code: 'FAMILY' },
    { name: 'Bereavement', code: 'BEREAVEMENT' },
    { name: 'Other', code: 'OTHER' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "leave_types" (` +
        `"id" SERIAL NOT NULL, ` +
        `"name" character varying(64) NOT NULL, ` +
        `"code" character varying(32) NOT NULL, ` +
        `"is_active" boolean NOT NULL DEFAULT true, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_leave_types_name" UNIQUE ("name"), ` +
        `CONSTRAINT "UQ_leave_types_code" UNIQUE ("code"), ` +
        `CONSTRAINT "PK_leave_types_id" PRIMARY KEY ("id"))`,
    );

    const values = this.seeds
      .map((s) => `('${s.name.replace(/'/g, "''")}', '${s.code}')`)
      .join(', ');
    await queryRunner.query(
      `INSERT INTO "leave_types" ("name", "code") VALUES ${values} ` +
        `ON CONFLICT ON CONSTRAINT "UQ_leave_types_code" DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "leave_types"`);
  }
}
