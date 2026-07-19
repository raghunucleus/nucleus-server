import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The per-drive status audit trail — one append-only row per lifecycle
 * transition, powering the Overview "Status history" timeline. Modelled on
 * `drive_student_events`. `from_status` is nullable (null for the first
 * recorded change), `actor_employee_id` is nullable audit-only (no FK — the
 * acting employee may be deactivated later).
 */
export class CreateDriveStatusEvents1795400000000 implements MigrationInterface {
  name = 'CreateDriveStatusEvents1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "drive_status_events" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_id" integer NOT NULL, ` +
        `"from_status" character varying(16), ` +
        `"to_status" character varying(16) NOT NULL, ` +
        `"actor_employee_id" integer, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_drive_status_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_status_events_drive_id" ` +
        `ON "drive_status_events" ("drive_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_status_events" ADD CONSTRAINT "FK_drive_status_events_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_status_events"`);
  }
}
