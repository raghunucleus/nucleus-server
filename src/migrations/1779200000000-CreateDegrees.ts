import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDegrees1779200000000 implements MigrationInterface {
  name = 'CreateDegrees1779200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "degrees" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "short_name" character varying(64) NOT NULL, "academic_level" character varying(16) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_degrees_name" UNIQUE ("name"), CONSTRAINT "UQ_degrees_code" UNIQUE ("code"), CONSTRAINT "UQ_degrees_short_name" UNIQUE ("short_name"), CONSTRAINT "PK_degrees_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "degrees"`);
  }
}
