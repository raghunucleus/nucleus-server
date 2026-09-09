<p align="center">
  <img src="src/brand/assets/nucleus-logo-horizontal.svg" width="280" alt="Nucleus" />
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Database migrations

Migrations are managed by TypeORM using the data source at [src/data-source.ts](src/data-source.ts). Migration files live in [src/migrations/](src/migrations/) and are tracked in the `migrations` table. `synchronize` is **off** — schema changes must go through a migration.

Make sure your `.env` is populated (see [sample.env](sample.env)) and Postgres is running (`docker compose -f docker/postgres/docker-compose.yml up -d`) before running any migration command.

```bash
# generate a migration from the diff between your entities and the current DB schema
$ npm run migration:generate -- src/migrations/<MigrationName>

# create an empty migration file (when you need to write SQL by hand)
$ npm run migration:create -- src/migrations/<MigrationName>

# apply all pending migrations
$ npm run migration:run

# revert the most recently applied migration
$ npm run migration:revert

# list applied / pending migrations
$ npm run migration:show
```

`migration:generate` compares your entity definitions against the live DB, so the database must be reachable and up to date with prior migrations before generating a new one.

### Examples

**1. You added a new `Admin` entity and want a migration for it:**

```bash
$ npm run migration:generate -- src/migrations/CreateAdminsTable
```

TypeORM writes a timestamped file like `src/migrations/1715000000000-CreateAdminsTable.ts` containing the `CREATE TABLE` for `admins` plus its indexes/constraints. Review the generated SQL, then apply it:

```bash
$ npm run migration:run
```

Expected output:

```
Migration CreateAdminsTable1715000000000 has been executed successfully.
```

**2. You need a data backfill or a change TypeORM cannot infer (e.g. seeding rows, renaming a column without losing data):**

```bash
$ npm run migration:create -- src/migrations/BackfillAdminUsernames
```

This creates an empty `up`/`down` skeleton — fill in the SQL yourself with `queryRunner.query(...)`, then run it with `npm run migration:run`.

**3. You ran a migration locally and want to undo it before regenerating:**

```bash
$ npm run migration:revert   # rolls back the most recently applied migration
$ npm run migration:show     # confirm it's back to pending ([ ])
```

`migration:show` output looks like:

```
[X] 1714000000000-CreateInitialSchema
[ ] 1715000000000-CreateAdminsTable
```

`[X]` = applied, `[ ]` = pending.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
