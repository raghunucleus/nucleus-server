import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account invitations — the single-use "set your password" links admins send
 * to newly created employees and students.
 *
 * One polymorphic table for both audiences (`subject_type` + `subject_id`).
 * `subject_id` deliberately carries no foreign key, so a CHECK constraint is
 * what keeps `subject_type` honest.
 *
 * No backfill: an account that already has a password derives as "active" from
 * its credential row, and one that doesn't derives as "not invited" — both are
 * correct with an empty table.
 */
export class CreateAccountInvites1796900000000 implements MigrationInterface {
  name = 'CreateAccountInvites1796900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_invites" (` +
        `"id" SERIAL NOT NULL, ` +
        `"subject_type" character varying(16) NOT NULL, ` +
        `"subject_id" integer NOT NULL, ` +
        `"email" character varying(255) NOT NULL, ` +
        `"token_hash" character varying(64) NOT NULL, ` +
        `"expires_at" TIMESTAMP NOT NULL, ` +
        `"accepted_at" TIMESTAMP, ` +
        `"revoked_at" TIMESTAMP, ` +
        `"resend_count" integer NOT NULL DEFAULT 0, ` +
        `"invited_by_admin_id" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_account_invites" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_invites" ADD CONSTRAINT "CHK_account_invites_subject_type" CHECK ("subject_type" IN ('employee', 'student'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_invites" ADD CONSTRAINT "UQ_account_invites_token_hash" UNIQUE ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_invites_subject_type_subject_id" ON "account_invites" ("subject_type", "subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_invites_expires_at" ON "account_invites" ("expires_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_invites" ADD CONSTRAINT "FK_account_invites_invited_by_admin_id" FOREIGN KEY ("invited_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_invites"`);
  }
}
