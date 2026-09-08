import 'dotenv/config';
import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { postgresSslOptions } from './config/datastore-ssl';

/**
 * The TypeORM CLI datasource — used by `npm run migration:*` in dev and by the
 * one-shot `migrate` service in the production compose stack, which invokes it
 * as the COMPILED `dist/data-source.js`. The running server never uses this
 * (`app.module.ts` builds its own connection, with `migrationsRun: false`).
 *
 * The globs are `__dirname`-relative, not cwd-relative, because those two
 * worlds resolve differently: under ts-node `__dirname` is `src/`, and inside
 * the image it is `/app/dist`. Cwd-relative `src/**` globs would silently match
 * zero entities and zero migrations in the container — `migration:run` would
 * report "No migrations are pending" against an empty database and the app would
 * start on a schema that does not exist.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: postgresSslOptions(),
  entities: [join(__dirname, '**', '*.entity.{js,ts}')],
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
  migrationsTableName: 'migrations',
  synchronize: false,
});
