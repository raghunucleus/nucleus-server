import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGuardianCredentials1781600100000 implements MigrationInterface {
    name = 'CreateGuardianCredentials1781600100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "guardian_credentials" ("id" SERIAL NOT NULL, "guardian_id" integer NOT NULL, "password_hash" character varying(255), "must_change_password" boolean NOT NULL DEFAULT false, "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" TIMESTAMP, "last_login_at" TIMESTAMP, "last_login_ip" character varying(45), "password_changed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_guardian_credentials_guardian_id" UNIQUE ("guardian_id"), CONSTRAINT "PK_guardian_credentials_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "guardian_credentials" ADD CONSTRAINT "FK_guardian_credentials_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guardian_credentials" DROP CONSTRAINT "FK_guardian_credentials_guardian_id"`);
        await queryRunner.query(`DROP TABLE "guardian_credentials"`);
    }

}
