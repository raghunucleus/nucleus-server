import { MigrationInterface, QueryRunner } from "typeorm";

export class SplitMobileCountryCode1778210000000 implements MigrationInterface {
    name = 'SplitMobileCountryCode1778210000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" ADD "country_code" character varying(8)`);

        // Backfill: split existing values like "+91XXXXXXXXXX" into ("91", "XXXXXXXXXX").
        await queryRunner.query(`
            UPDATE "admins"
            SET
                "country_code" = CASE
                    WHEN "mobile_number" ~ '^\\+[0-9]+'
                        THEN substring("mobile_number" from '^\\+([0-9]{1,8})')
                    ELSE NULL
                END,
                "mobile_number" = CASE
                    WHEN "mobile_number" ~ '^\\+[0-9]+'
                        THEN regexp_replace("mobile_number", '^\\+[0-9]+', '')
                    ELSE "mobile_number"
                END
            WHERE "mobile_number" IS NOT NULL
        `);

        // Shrink the local-number column now that the prefix is gone.
        await queryRunner.query(`ALTER TABLE "admins" ALTER COLUMN "mobile_number" TYPE character varying(16)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" ALTER COLUMN "mobile_number" TYPE character varying(32)`);

        // Re-merge: prepend "+<country_code>" back onto mobile_number.
        await queryRunner.query(`
            UPDATE "admins"
            SET "mobile_number" = '+' || "country_code" || "mobile_number"
            WHERE "mobile_number" IS NOT NULL AND "country_code" IS NOT NULL
        `);

        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "country_code"`);
    }

}
