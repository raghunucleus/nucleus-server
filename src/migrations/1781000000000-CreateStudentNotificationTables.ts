import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Student notification system: persisted notifications + Expo push tokens.
 *
 * Hand-written (like the chat tables) so it touches only the two new tables and
 * uses the codebase's readable FK/index names rather than TypeORM hash defaults.
 */
export class CreateStudentNotificationTables1781000000000
  implements MigrationInterface
{
  name = 'CreateStudentNotificationTables1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "student_notifications" (
        "id" SERIAL NOT NULL,
        "student_id" integer NOT NULL,
        "module" character varying(32) NOT NULL,
        "type" character varying(64) NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" text NOT NULL,
        "target" jsonb,
        "read_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_notifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_notifications_student_id_created_at" ON "student_notifications" ("student_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_notifications_student_id_read_at" ON "student_notifications" ("student_id", "read_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "student_push_tokens" (
        "id" SERIAL NOT NULL,
        "student_id" integer NOT NULL,
        "expo_push_token" character varying(255) NOT NULL,
        "platform" character varying(16),
        "device_id" character varying(128),
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_student_push_tokens_token" UNIQUE ("expo_push_token"),
        CONSTRAINT "PK_student_push_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_push_tokens_student_id" ON "student_push_tokens" ("student_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "student_notifications"
        ADD CONSTRAINT "FK_student_notifications_student_id"
        FOREIGN KEY ("student_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "student_push_tokens"
        ADD CONSTRAINT "FK_student_push_tokens_student_id"
        FOREIGN KEY ("student_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_push_tokens" DROP CONSTRAINT "FK_student_push_tokens_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_notifications" DROP CONSTRAINT "FK_student_notifications_student_id"`,
    );
    await queryRunner.query(`DROP TABLE "student_push_tokens"`);
    await queryRunner.query(`DROP TABLE "student_notifications"`);
  }
}
