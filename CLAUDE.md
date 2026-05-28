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

## RBAC enforcement contract

Every protected employee-facing controller method MUST follow this contract. Violations silently leak data — there are no warnings.

1. **Guard + decorator**: pair `EmployeeJwtAuthGuard` with `ScreenAccessGuard` and tag the handler with `@RequireScreen('<screen.key>', '<action>')`. Without `@RequireScreen` the screen guard is a no-op.

   ```ts
   @RequireScreen('academics.timetable.manage', 'edit')
   @UseGuards(EmployeeJwtAuthGuard, ScreenAccessGuard)
   @Patch(':id') updateTimetable(...) { ... }
   ```

2. **Scope every query/mutation** that touches per-attribute data using the matching `PermissionsService.getAccessibleXIds(employee.id, screenKey)` helper. The helper returns `number[] | 'all'` (the `ACCESS_ALL` sentinel) — handle BOTH branches:

   ```ts
   const depts = await this.permissions.getAccessibleDepartmentIds(emp.id, KEY);
   if (depts === 'all') {
     // wildcard — no department filter
   } else if (depts.length === 0) {
     return [];                       // no access — empty result
   } else {
     qb.andWhere('x.department_id IN (:...depts)', { depts });
   }
   ```

   The three states are NOT interchangeable: `'all'` = no filter (the employee's role wildcarded this attribute), `[]` = no access (return empty — never fall back to "all rows"), `[1,2,3]` = filter to these. The wildcard only happens when the catalog attribute has `allow_all: true` AND the assignment was saved with the `{ all: true }` value.

3. **For mutations on a specific row**, verify the target's scope key is in the accessible list before writing — or accept any value when the helper returned `'all'`. A `PATCH /:id` with no scope check leaks across tenants the moment the guard says "yes, you can edit *some* department's timetable".

4. **No magic interceptors.** Every controller does the scoping explicitly so guards remain greppable and reviewable. Raw SQL / non-TypeORM queries are still subject to the contract — wrap them with the same helpers.

## Student-facing API isolation

Every student-facing controller method MUST derive the acting student exclusively from the JWT — never from a route param, query string, or request body. A student can only ever see and mutate their own data.

1. **Mount student endpoints under `/student/*`** and guard them with `StudentJwtAuthGuard` (plus `RequirePasswordChangedGuard` unless the route is the change-password flow itself). Never reuse `/admin/*` or `/employee/*` controllers for student traffic.

   ```ts
   @UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
   @ApiBearerAuth('student-access-token')
   @Controller('student/timetable')
   export class StudentTimetableController { ... }
   ```

2. **Read the student id from the token via `@GetStudent()`** and pass it straight to the service. No `:studentId` path param, no `student_id` body field, no `?student_id=` query — there is no legitimate reason for a student to scope a request to any id other than their own.

   ```ts
   // good
   @Get('week')
   week(@GetStudent() s: AuthenticatedStudent, @Query() q: WeekQueryDto) {
     return this.svc.week(s.id, q.week_start, q.week_end);
   }

   // bad — accepts an arbitrary studentId, trivially leaks across students
   @Get(':studentId/week')
   week(@Param('studentId') id: number, @Query() q: WeekQueryDto) { ... }
   ```

3. **If a student-facing service is shared with admin/employee code**, keep the shared service signature as `(studentId, ...)` but only ever pass `req.user.id` from the student controller. The same service is fine to call from `/admin/*` with an arbitrary id under the admin RBAC contract above; mixing the two on a single route is not.

4. **Never trust client-supplied identifiers** for joins, filters, or audit fields on student routes. `programme_semester_id`, `attendance_group_id`, `subject_id` etc. that aren't explicit user input must be derived server-side from the token's student.
