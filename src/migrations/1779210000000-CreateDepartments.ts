import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDepartments1779210000000 implements MigrationInterface {
  name = 'CreateDepartments1779210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "departments" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "short_name" character varying(64) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_departments_name" UNIQUE ("name"), CONSTRAINT "UQ_departments_code" UNIQUE ("code"), CONSTRAINT "UQ_departments_short_name" UNIQUE ("short_name"), CONSTRAINT "PK_departments_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "departments"`);
  }
}
