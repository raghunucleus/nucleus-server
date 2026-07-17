import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redesign: guardians are no longer a global identity. Drop the `guardians`
 * profile table and the dedup/account model. Store guardian contact details
 * per-student in `student_guardians`, and key login auth-state + OTPs by mobile
 * number. The same person can be a different relationship per student with no
 * reconciliation.
 */
export class RedesignGuardianContacts1781700000000 implements MigrationInterface {
  name = 'RedesignGuardianContacts1781700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tear down the old account-based schema.
    await queryRunner.query(`DROP TABLE IF EXISTS "guardian_otps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guardian_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_guardians"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guardians"`);

    // Per-student guardian contact details (the only place guardian data lives).
    await queryRunner.query(
      `CREATE TABLE "student_guardians" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "relationship" character varying(16) NOT NULL, "name" character varying(128) NOT NULL, "mobile_number" character varying(16) NOT NULL, "email" character varying(255), "is_primary" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_guardians_student_id_relationship" UNIQUE ("student_id", "relationship"), CONSTRAINT "PK_student_guardians_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_mobile_number" ON "student_guardians" ("mobile_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_student_id" ON "student_guardians" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" ADD CONSTRAINT "FK_student_guardians_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Login auth-state keyed by mobile number.
    await queryRunner.query(
      `CREATE TABLE "guardian_credentials" ("id" SERIAL NOT NULL, "mobile_number" character varying(16) NOT NULL, "password_hash" character varying(255), "must_change_password" boolean NOT NULL DEFAULT false, "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" TIMESTAMP, "last_login_at" TIMESTAMP, "last_login_ip" character varying(45), "password_changed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_guardian_credentials_mobile_number" UNIQUE ("mobile_number"), CONSTRAINT "PK_guardian_credentials_id" PRIMARY KEY ("id"))`,
    );

    // Password OTPs keyed by mobile number.
    await queryRunner.query(
      `CREATE TABLE "guardian_otps" ("id" SERIAL NOT NULL, "mobile_number" character varying(16) NOT NULL, "otp_hash" character varying(64) NOT NULL, "channel" character varying(16) NOT NULL, "expires_at" TIMESTAMP NOT NULL, "attempt_count" integer NOT NULL DEFAULT 0, "consumed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_guardian_otps_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardian_otps_mobile_number" ON "guardian_otps" ("mobile_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardian_otps_expires_at" ON "guardian_otps" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the per-student schema.
    await queryRunner.query(`DROP TABLE IF EXISTS "guardian_otps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guardian_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_guardians"`);

    // Recreate the original account-based schema.
    await queryRunner.query(
      `CREATE TABLE "guardians" ("id" SERIAL NOT NULL, "mobile_number" character varying(16) NOT NULL, "display_name" character varying(128) NOT NULL, "email" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_guardians_mobile_number" UNIQUE ("mobile_number"), CONSTRAINT "PK_guardians_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardians_email" ON "guardians" ("email")`,
    );
    await queryRunner.query(
      `CREATE TABLE "guardian_credentials" ("id" SERIAL NOT NULL, "guardian_id" integer NOT NULL, "password_hash" character varying(255), "must_change_password" boolean NOT NULL DEFAULT false, "failed_login_attempts" integer NOT NULL DEFAULT 0, "locked_until" TIMESTAMP, "last_login_at" TIMESTAMP, "last_login_ip" character varying(45), "password_changed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_guardian_credentials_guardian_id" UNIQUE ("guardian_id"), CONSTRAINT "PK_guardian_credentials_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "guardian_credentials" ADD CONSTRAINT "FK_guardian_credentials_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "student_guardians" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "guardian_id" integer NOT NULL, "relationship" character varying(16) NOT NULL, "is_primary" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_guardians_student_id_guardian_id" UNIQUE ("student_id", "guardian_id"), CONSTRAINT "PK_student_guardians_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_guardian_id" ON "student_guardians" ("guardian_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_guardians_student_id" ON "student_guardians" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" ADD CONSTRAINT "FK_student_guardians_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_guardians" ADD CONSTRAINT "FK_student_guardians_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "guardian_otps" ("id" SERIAL NOT NULL, "guardian_id" integer NOT NULL, "otp_hash" character varying(64) NOT NULL, "channel" character varying(16) NOT NULL, "expires_at" TIMESTAMP NOT NULL, "attempt_count" integer NOT NULL DEFAULT 0, "consumed_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_guardian_otps_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardian_otps_guardian_id" ON "guardian_otps" ("guardian_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guardian_otps_expires_at" ON "guardian_otps" ("expires_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "guardian_otps" ADD CONSTRAINT "FK_guardian_otps_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
