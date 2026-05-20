import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDevMailOutbox1779700000000 implements MigrationInterface {
    name = 'CreateDevMailOutbox1779700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dev_mail_outbox" ("id" SERIAL NOT NULL, "to_address" character varying(255) NOT NULL, "subject" character varying(255) NOT NULL, "body_text" text NOT NULL, "body_html" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dev_mail_outbox_id" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "dev_mail_outbox"`);
    }

}
