import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRbacTables1780100000000 implements MigrationInterface {
    name = 'CreateRbacTables1780100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // roles --------------------------------------------------------------
        await queryRunner.query(`CREATE TABLE "roles" ("id" SERIAL NOT NULL, "code" character varying(32) NOT NULL, "name" character varying(128) NOT NULL, "description" text, "role_type_keys" jsonb NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_roles_code" UNIQUE ("code"), CONSTRAINT "UQ_roles_name" UNIQUE ("name"), CONSTRAINT "PK_roles_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_roles_is_active" ON "roles" ("is_active")`);

        // role_screens -------------------------------------------------------
        await queryRunner.query(`CREATE TABLE "role_screens" ("id" SERIAL NOT NULL, "role_id" integer NOT NULL, "screen_key" character varying(128) NOT NULL, "allowed_actions" jsonb NOT NULL, CONSTRAINT "UQ_role_screens_role_id_screen_key" UNIQUE ("role_id", "screen_key"), CONSTRAINT "PK_role_screens_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_role_screens_role_id" ON "role_screens" ("role_id")`);
        await queryRunner.query(`ALTER TABLE "role_screens" ADD CONSTRAINT "FK_role_screens_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // role_assignments ---------------------------------------------------
        // One assignment per employee — the unique constraint enforces it.
        // No is_active column: revoke = hard delete (attributes cascade).
        await queryRunner.query(`CREATE TABLE "role_assignments" ("id" SERIAL NOT NULL, "role_id" integer NOT NULL, "employee_id" integer NOT NULL, "assigned_by_admin_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_role_assignments_employee_id" UNIQUE ("employee_id"), CONSTRAINT "PK_role_assignments_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_role_assignments_role_id" ON "role_assignments" ("role_id")`);
        await queryRunner.query(`ALTER TABLE "role_assignments" ADD CONSTRAINT "FK_role_assignments_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_assignments" ADD CONSTRAINT "FK_role_assignments_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // role_assignment_attributes ----------------------------------------
        await queryRunner.query(`CREATE TABLE "role_assignment_attributes" ("id" SERIAL NOT NULL, "role_assignment_id" integer NOT NULL, "screen_key" character varying(128) NOT NULL, "attribute_key" character varying(64) NOT NULL, "value" jsonb NOT NULL, CONSTRAINT "UQ_raa_assignment_screen_attribute" UNIQUE ("role_assignment_id", "screen_key", "attribute_key"), CONSTRAINT "PK_role_assignment_attributes_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_raa_assignment_id" ON "role_assignment_attributes" ("role_assignment_id")`);
        await queryRunner.query(`ALTER TABLE "role_assignment_attributes" ADD CONSTRAINT "FK_raa_assignment_id" FOREIGN KEY ("role_assignment_id") REFERENCES "role_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "role_assignment_attributes" DROP CONSTRAINT "FK_raa_assignment_id"`);
        await queryRunner.query(`DROP INDEX "IDX_raa_assignment_id"`);
        await queryRunner.query(`DROP TABLE "role_assignment_attributes"`);

        await queryRunner.query(`ALTER TABLE "role_assignments" DROP CONSTRAINT "FK_role_assignments_employee_id"`);
        await queryRunner.query(`ALTER TABLE "role_assignments" DROP CONSTRAINT "FK_role_assignments_role_id"`);
        await queryRunner.query(`DROP INDEX "IDX_role_assignments_role_id"`);
        await queryRunner.query(`DROP TABLE "role_assignments"`);

        await queryRunner.query(`ALTER TABLE "role_screens" DROP CONSTRAINT "FK_role_screens_role_id"`);
        await queryRunner.query(`DROP INDEX "IDX_role_screens_role_id"`);
        await queryRunner.query(`DROP TABLE "role_screens"`);

        await queryRunner.query(`DROP INDEX "IDX_roles_is_active"`);
        await queryRunner.query(`DROP TABLE "roles"`);
    }

}
