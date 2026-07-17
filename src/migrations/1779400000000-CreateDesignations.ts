import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDesignations1779400000000 implements MigrationInterface {
  name = 'CreateDesignations1779400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "designations" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_designations_name" UNIQUE ("name"), CONSTRAINT "UQ_designations_code" UNIQUE ("code"), CONSTRAINT "PK_designations_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "designations"`);
  }
}
