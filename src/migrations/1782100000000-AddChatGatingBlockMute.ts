import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the consent gate (message requests), per-participant block, and
 * per-participant mute to one-to-one student chat.
 *
 * Hand-written (like the original chat tables) so it touches only the new
 * columns/constraints and uses readable names rather than TypeORM hash
 * defaults. All pre-existing conversations are backfilled to `accepted` — the
 * gate only applies to conversations opened from here on.
 */
export class AddChatGatingBlockMute1782100000000 implements MigrationInterface {
  name = 'AddChatGatingBlockMute1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        ADD "status" character varying(16) NOT NULL DEFAULT 'pending',
        ADD "initiated_by_id" integer,
        ADD "low_muted" boolean NOT NULL DEFAULT false,
        ADD "high_muted" boolean NOT NULL DEFAULT false,
        ADD "low_blocked" boolean NOT NULL DEFAULT false,
        ADD "high_blocked" boolean NOT NULL DEFAULT false
    `);

    // Existing conversations predate the gate — treat them all as accepted.
    await queryRunner.query(
      `UPDATE "chat_conversations" SET "status" = 'accepted'`,
    );

    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        ADD CONSTRAINT "CHK_chat_conversations_status"
        CHECK ("status" IN ('pending', 'accepted'))
    `);

    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        ADD CONSTRAINT "FK_chat_conversations_initiated_by_id"
        FOREIGN KEY ("initiated_by_id") REFERENCES "students"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Partial index for the Requests-inbox lookup (only pending rows). Kept
    // migration-only — TypeORM decorators can't express the partial WHERE.
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_conversations_pending"
        ON "chat_conversations" ("student_low_id", "student_high_id")
        WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_chat_conversations_pending"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversations" DROP CONSTRAINT "FK_chat_conversations_initiated_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversations" DROP CONSTRAINT "CHK_chat_conversations_status"`,
    );
    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        DROP COLUMN "high_blocked",
        DROP COLUMN "low_blocked",
        DROP COLUMN "high_muted",
        DROP COLUMN "low_muted",
        DROP COLUMN "initiated_by_id",
        DROP COLUMN "status"
    `);
  }
}
