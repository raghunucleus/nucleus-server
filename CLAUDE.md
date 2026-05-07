# nucleus-server

NestJS + TypeORM + PostgreSQL + Redis backend.

## TypeORM entity conventions

These rules apply to every file under `src/**/entities/*.entity.ts`.

### Property naming

- **Use `snake_case` for entity property names** so they match the database column names directly.
- When the property name already matches the column name, **drop the `name:` option** from the decorator — it is redundant.

```ts
// good
@Column({ type: 'varchar', length: 255 })
password_hash: string;

@CreateDateColumn()
created_at: Date;

// bad — camelCase property forces a `name:` mapping
@Column({ type: 'varchar', length: 255, name: 'password_hash' })
passwordHash: string;
```

### Indexes and unique constraints

1. **Declare them at the class level**, above `export class`. Never put `@Index` on a column.
2. **Use `@Unique` for uniqueness, `@Index` for non-unique indexes only.** Never write `@Index(..., { unique: true })` — `@Unique` emits a real SQL `UNIQUE` constraint (visible in `\d` as a constraint, FK-referenceable everywhere), while `@Index({ unique })` only creates a unique index. They store the same way in Postgres but are semantically different.
3. **Always pass an explicit name** as the first argument. Never let TypeORM auto-generate a random `IDX_<hash>` / `UQ_<hash>` name — those are unstable across migrations and unreadable in DB tooling.
4. **Naming pattern is `<PREFIX>_<table>_<column>`** (table name is mandatory):
   - `@Index` → `IDX_` prefix, e.g. `@Index('IDX_users_email', ['email'])`
   - `@Unique` → `UQ_` prefix, e.g. `@Unique('UQ_admins_username', ['username'])`
   - Composite: join column names with `_`, e.g. `IDX_orders_user_id_status`

```ts
@Entity({ name: 'admins' })
@Unique('UQ_admins_username', ['username'])
@Unique('UQ_admins_email', ['email'])
export class Admin {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

## TypeScript

- `strictPropertyInitialization` is intentionally **disabled** in `tsconfig.json` so entity classes don't need `!` definite-assignment assertions on every field. This is project-wide; do not re-enable it without discussion.
