import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGuardianOtps1781600300000 implements MigrationInterface {
    name = 'CreateGuardianOtps1781600300000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "guardian_otps" ("id" SERIAL NOT NULL, "guardian_id" integer NOT NULL, "otp_hash" character varying(64) NOT NULL, "channel" character varying(16) NOT NULL, "expires_at" TIMESTAMP NOT NULL, "attempt_count" integer NOT NULL DEFAULT 0, "consumed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_guardian_otps_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_guardian_otps_guardian_id" ON "guardian_otps" ("guardian_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_guardian_otps_expires_at" ON "guardian_otps" ("expires_at")`);
        await queryRunner.query(`ALTER TABLE "guardian_otps" ADD CONSTRAINT "FK_guardian_otps_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guardian_otps" DROP CONSTRAINT "FK_guardian_otps_guardian_id"`);
        await queryRunner.query(`DROP INDEX "IDX_guardian_otps_expires_at"`);
        await queryRunner.query(`DROP INDEX "IDX_guardian_otps_guardian_id"`);
        await queryRunner.query(`DROP TABLE "guardian_otps"`);
    }

}
