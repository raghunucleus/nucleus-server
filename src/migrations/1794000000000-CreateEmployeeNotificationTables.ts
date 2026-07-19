import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee notification system: persisted notifications, Expo push tokens, and
 * per-module delivery preferences.
 *
 * Hand-written (like the student notification tables) so it touches only the
 * three new tables and uses the codebase's readable FK/index names rather than
 * TypeORM hash defaults.
 *
 * `employee_notification_preferences` stores OVERRIDES ONLY — no row means both
 * channels are on — so there is nothing to backfill for existing employees.
 */
export class CreateEmployeeNotificationTables1794000000000 implements MigrationInterface {
  name = 'CreateEmployeeNotificationTables1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "employee_notifications" (
        "id" SERIAL NOT NULL,
        "employee_id" integer NOT NULL,
        "module" character varying(32) NOT NULL,
        "type" character varying(64) NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" text NOT NULL,
        "target" jsonb,
        "read_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_employee_notifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_employee_notifications_employee_id_created_at" ON "employee_notifications" ("employee_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employee_notifications_employee_id_read_at" ON "employee_notifications" ("employee_id", "read_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "employee_push_tokens" (
        "id" SERIAL NOT NULL,
        "employee_id" integer NOT NULL,
        "expo_push_token" character varying(255) NOT NULL,
        "platform" character varying(16),
        "device_id" character varying(128),
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_employee_push_tokens_token" UNIQUE ("expo_push_token"),
        CONSTRAINT "PK_employee_push_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_employee_push_tokens_employee_id" ON "employee_push_tokens" ("employee_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "employee_notification_preferences" (
        "id" SERIAL NOT NULL,
        "employee_id" integer NOT NULL,
        "module_key" character varying(32) NOT NULL,
        "email_enabled" boolean NOT NULL DEFAULT true,
        "push_enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_employee_notification_preferences_employee_id_module_key" UNIQUE ("employee_id", "module_key"),
        CONSTRAINT "PK_employee_notification_preferences" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "employee_notifications"
        ADD CONSTRAINT "FK_employee_notifications_employee_id"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "employee_push_tokens"
        ADD CONSTRAINT "FK_employee_push_tokens_employee_id"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "employee_notification_preferences"
        ADD CONSTRAINT "FK_employee_notification_preferences_employee_id"
        FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employee_notification_preferences" DROP CONSTRAINT "FK_employee_notification_preferences_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_push_tokens" DROP CONSTRAINT "FK_employee_push_tokens_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_notifications" DROP CONSTRAINT "FK_employee_notifications_employee_id"`,
    );
    await queryRunner.query(`DROP TABLE "employee_notification_preferences"`);
    await queryRunner.query(`DROP TABLE "employee_push_tokens"`);
    await queryRunner.query(`DROP TABLE "employee_notifications"`);
  }
}
