import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTotpAndRecoveryCodes1778600000000 implements MigrationInterface {
    name = 'AddTotpAndRecoveryCodes1778600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" ADD "totp_secret" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "totp_enabled_at" TIMESTAMP`);

        await queryRunner.query(`
            CREATE TABLE "admin_recovery_codes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "admin_id" integer NOT NULL,
                "code_hash" character varying(255) NOT NULL,
                "used_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_admin_recovery_codes" PRIMARY KEY ("id"),
                CONSTRAINT "FK_admin_recovery_codes_admin_id" FOREIGN KEY ("admin_id")
                    REFERENCES "admins"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_admin_recovery_codes_admin_id" ON "admin_recovery_codes" ("admin_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_admin_recovery_codes_admin_id"`);
        await queryRunner.query(`DROP TABLE "admin_recovery_codes"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "totp_enabled_at"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "totp_secret"`);
    }

}
