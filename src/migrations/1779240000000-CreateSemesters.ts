import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSemesters1779240000000 implements MigrationInterface {
    name = 'CreateSemesters1779240000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "semesters" ("id" SERIAL NOT NULL, "sem_number" integer NOT NULL, "code" character varying(16) NOT NULL, "name" character varying(64) NOT NULL, "year_sem_format" character varying(16) NOT NULL, "roman_format" character varying(8) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_semesters_sem_number" UNIQUE ("sem_number"), CONSTRAINT "UQ_semesters_code" UNIQUE ("code"), CONSTRAINT "PK_semesters_id" PRIMARY KEY ("id"))`);

        // Seed standard 8-semester structure used by most UG programs. Admins
        // can deactivate or extend (PG, integrated degrees, etc.) afterwards.
        await queryRunner.query(`INSERT INTO "semesters" ("sem_number", "code", "name", "year_sem_format", "roman_format") VALUES
            (1, 'SEM1', 'Semester 1', '1-1', 'I'),
            (2, 'SEM2', 'Semester 2', '1-2', 'II'),
            (3, 'SEM3', 'Semester 3', '2-1', 'III'),
            (4, 'SEM4', 'Semester 4', '2-2', 'IV'),
            (5, 'SEM5', 'Semester 5', '3-1', 'V'),
            (6, 'SEM6', 'Semester 6', '3-2', 'VI'),
            (7, 'SEM7', 'Semester 7', '4-1', 'VII'),
            (8, 'SEM8', 'Semester 8', '4-2', 'VIII')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "semesters"`);
    }

}
