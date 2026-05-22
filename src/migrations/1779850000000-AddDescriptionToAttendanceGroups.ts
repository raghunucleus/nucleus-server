import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDescriptionToAttendanceGroups1779850000000 implements MigrationInterface {
    name = 'AddDescriptionToAttendanceGroups1779850000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attendance_groups" ADD "description" character varying(256)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "attendance_groups" DROP COLUMN "description"`);
    }

}
