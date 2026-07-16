import { MigrationInterface, QueryRunner } from 'typeorm';
import { INDIA_GEO } from './seed-data/india-geo.seed';

// Creates the address master tree — countries -> states -> districts — surfaced
// under Additional Attributes -> Address attributes, and seeds it with India
// (36 states/UTs, 765 districts) from the Local Government Directory. See
// seed-data/india-geo.seed.ts for provenance.
//
// Nothing references these tables yet: the existing free-text address columns on
// `companies` and `institution_settings` are deliberately untouched.
//
// Schema and seed live in one migration on purpose. TypeORM wraps a migration in
// a transaction, so a bad seed rolls the tables back with it rather than leaving
// a half-built tree, and down() drops the tables which reverts the seed for free.
//
// Every insert upserts, so re-running against a populated DB is a no-op rather
// than a crash.
export class CreateAddressAttributes1792700000000 implements MigrationInterface {
  name = 'CreateAddressAttributes1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "countries" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "iso2" character varying(2), "iso3" character varying(3), "dial_code" character varying(8), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_countries_name" UNIQUE ("name"), CONSTRAINT "UQ_countries_iso2" UNIQUE ("iso2"), CONSTRAINT "UQ_countries_iso3" UNIQUE ("iso3"), CONSTRAINT "PK_countries_id" PRIMARY KEY ("id"))`,
    );

    // No IDX_states_country_id: UQ_states_country_id_name already leads with
    // country_id, and a composite unique index serves prefix lookups on its
    // leading column. Same for districts.
    await queryRunner.query(
      `CREATE TABLE "states" ("id" SERIAL NOT NULL, "country_id" integer NOT NULL, "name" character varying(128) NOT NULL, "lgd_code" character varying(16), "iso_code" character varying(8), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_states_country_id_name" UNIQUE ("country_id", "name"), CONSTRAINT "UQ_states_lgd_code" UNIQUE ("lgd_code"), CONSTRAINT "UQ_states_iso_code" UNIQUE ("iso_code"), CONSTRAINT "PK_states_id" PRIMARY KEY ("id"), CONSTRAINT "FK_states_country_id" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT)`,
    );

    await queryRunner.query(
      `CREATE TABLE "districts" ("id" SERIAL NOT NULL, "state_id" integer NOT NULL, "name" character varying(128) NOT NULL, "lgd_code" character varying(16), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_districts_state_id_name" UNIQUE ("state_id", "name"), CONSTRAINT "UQ_districts_lgd_code" UNIQUE ("lgd_code"), CONSTRAINT "PK_districts_id" PRIMARY KEY ("id"), CONSTRAINT "FK_districts_state_id" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT)`,
    );

    await this.seed(queryRunner);
  }

  private async seed(queryRunner: QueryRunner): Promise<void> {
    const { country, states } = INDIA_GEO;

    // DO UPDATE rather than DO NOTHING: `ON CONFLICT DO NOTHING ... RETURNING`
    // yields ZERO rows on conflict, which would leave countryId undefined and
    // fail every state insert against NOT NULL. DO UPDATE always returns the row.
    //
    // is_active is never in a DO UPDATE SET list here — on a re-run against a
    // live DB, resurrecting a row an admin deliberately deactivated would be
    // silent data corruption. Only names and codes are upserted.
    const countryRows: Array<{ id: number }> = await queryRunner.query(
      `INSERT INTO "countries" ("name", "iso2", "iso3", "dial_code")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT "UQ_countries_iso2"
       DO UPDATE SET "name" = EXCLUDED."name",
                     "iso3" = EXCLUDED."iso3",
                     "dial_code" = EXCLUDED."dial_code",
                     "updated_at" = now()
       RETURNING "id"`,
      [country.name, country.iso2, country.iso3, country.dial_code],
    );
    const countryId = countryRows[0].id;

    for (const state of states) {
      const stateRows: Array<{ id: number }> = await queryRunner.query(
        `INSERT INTO "states" ("country_id", "name", "lgd_code", "iso_code")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT "UQ_states_country_id_name"
         DO UPDATE SET "lgd_code" = EXCLUDED."lgd_code",
                       "iso_code" = EXCLUDED."iso_code",
                       "updated_at" = now()
         RETURNING "id"`,
        [countryId, state.name, state.lgd_code, state.iso_code],
      );
      const stateId = stateRows[0].id;

      if (state.districts.length === 0) continue;

      // One multi-row INSERT per state. The largest (Uttar Pradesh, 75) is far
      // inside Postgres' 65535-parameter ceiling at 3 params per row.
      const params: unknown[] = [];
      const tuples = state.districts.map((d) => {
        params.push(stateId, d.name, d.lgd_code);
        const i = params.length;
        return `($${i - 2}, $${i - 1}, $${i})`;
      });

      await queryRunner.query(
        `INSERT INTO "districts" ("state_id", "name", "lgd_code")
         VALUES ${tuples.join(', ')}
         ON CONFLICT ON CONSTRAINT "UQ_districts_state_id_name"
         DO UPDATE SET "lgd_code" = EXCLUDED."lgd_code",
                       "updated_at" = now()`,
        params,
      );
    }

    await this.assertSeeded(queryRunner, countryId);
  }

  // Fail loudly inside the transaction rather than ship a half-populated
  // dropdown. A truncated or malformed seed file rolls the whole migration back.
  private async assertSeeded(
    queryRunner: QueryRunner,
    countryId: number,
  ): Promise<void> {
    const expectedStates = INDIA_GEO.states.length;
    const expectedDistricts = INDIA_GEO.states.reduce(
      (sum, s) => sum + s.districts.length,
      0,
    );

    const [{ count: stateCount }]: Array<{ count: string }> =
      await queryRunner.query(
        `SELECT count(*)::int AS count FROM "states" WHERE "country_id" = $1`,
        [countryId],
      );
    const [{ count: districtCount }]: Array<{ count: string }> =
      await queryRunner.query(
        `SELECT count(*)::int AS count FROM "districts" d
         JOIN "states" s ON s.id = d.state_id
         WHERE s."country_id" = $1`,
        [countryId],
      );

    if (Number(stateCount) !== expectedStates) {
      throw new Error(
        `Address seed: expected ${expectedStates} states for India, found ${stateCount}`,
      );
    }
    if (Number(districtCount) !== expectedDistricts) {
      throw new Error(
        `Address seed: expected ${expectedDistricts} districts for India, found ${districtCount}`,
      );
    }
    // 28 states + 8 union territories. Stable enough to be a useful canary for a
    // truncated seed file; the district total is derived above rather than
    // hardcoded, because it drifts with every state reorganisation.
    if (expectedStates !== 36) {
      throw new Error(
        `Address seed: expected 36 states/UTs in the seed data, found ${expectedStates}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse FK order.
    await queryRunner.query(`DROP TABLE "districts"`);
    await queryRunner.query(`DROP TABLE "states"`);
    await queryRunner.query(`DROP TABLE "countries"`);
  }
}
