import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRegulations1779270000000 implements MigrationInterface {
  name = 'CreateRegulations1779270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "regulations" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_regulations_name" UNIQUE ("name"), CONSTRAINT "UQ_regulations_code" UNIQUE ("code"), CONSTRAINT "PK_regulations_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "regulations"`);
  }
}
