import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-to-one student chat ("Connect"): conversations + messages.
 *
 * Hand-written rather than left as auto-generated output — `migration:generate`
 * also wanted to churn dozens of unrelated, pre-named constraints because the
 * live schema's readable FK/UQ names don't match TypeORM's hash defaults. This
 * migration touches only the two new tables.
 */
export class CreateChatTables1780011484524 implements MigrationInterface {
  name = 'CreateChatTables1780011484524';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_conversations" (
        "id" SERIAL NOT NULL,
        "student_low_id" integer NOT NULL,
        "student_high_id" integer NOT NULL,
        "attendance_group_id" integer,
        "low_last_read_message_id" integer,
        "high_last_read_message_id" integer,
        "last_message_at" TIMESTAMP WITH TIME ZONE,
        "last_message_preview" character varying(200),
        "last_message_sender_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_chat_conversations_pair" UNIQUE ("student_low_id", "student_high_id"),
        CONSTRAINT "PK_chat_conversations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_conversations_student_low" ON "chat_conversations" ("student_low_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_conversations_student_high" ON "chat_conversations" ("student_high_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id" SERIAL NOT NULL,
        "conversation_id" integer NOT NULL,
        "sender_id" integer NOT NULL,
        "body" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_conversation_id_id" ON "chat_messages" ("conversation_id", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_created_at" ON "chat_messages" ("created_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        ADD CONSTRAINT "FK_chat_conversations_student_low_id"
        FOREIGN KEY ("student_low_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_conversations"
        ADD CONSTRAINT "FK_chat_conversations_student_high_id"
        FOREIGN KEY ("student_high_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD CONSTRAINT "FK_chat_messages_conversation_id"
        FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD CONSTRAINT "FK_chat_messages_sender_id"
        FOREIGN KEY ("sender_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_sender_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_conversation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversations" DROP CONSTRAINT "FK_chat_conversations_student_high_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_conversations" DROP CONSTRAINT "FK_chat_conversations_student_low_id"`,
    );
    await queryRunner.query(`DROP TABLE "chat_messages"`);
    await queryRunner.query(`DROP TABLE "chat_conversations"`);
  }
}
