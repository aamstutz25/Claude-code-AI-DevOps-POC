# Database

## Identities and privileges

The application uses two separate SQL identities. Neither has any server-level role.

| Identity                   | Example login  | Used by                     | Privileges                                               |
| -------------------------- | -------------- | --------------------------- | -------------------------------------------------------- |
| Migration (deployment)     | `poc_migrator` | `npm run db:migrate` only   | `db_owner` of the application database only              |
| Runtime                    | `poc_app`      | the running API             | member of `app_runtime` only: `SELECT` on `dbo.Greeting` |
| Administrator (setup only) | `sa` / Windows | bootstrap scripts, CI setup | creates the database and logins                          |

- **Object permissions live in migrations.** A migration that adds something the application
  uses also grants the minimum access to the `app_runtime` role (see
  `migrations/002_app_runtime_permissions.sql`). This versions permissions with the schema.
- **Logins and role membership live in the bootstrap scripts**, which an administrator runs
  once per environment.
- The integration tests check this: the runtime login must not be `db_owner`, must not be
  able to create tables or change data, and may only read `dbo.Greeting`.

## Bootstrap scripts (once per environment, as an administrator)

| Script                                 | Contains passwords | What it does                                                                                     |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `bootstrap/01_database_and_logins.sql` | yes (variables)    | creates the database and both logins, if missing                                                 |
| `bootstrap/02_database_access.sql`     | no                 | database users, `app_runtime` role and membership; removes the runtime login from any other role |

Both use sqlcmd-style `$(VARIABLE)` placeholders: `DB_NAME`, `MIGRATOR_LOGIN`, `APP_LOGIN`, and
for script 01 also `MIGRATOR_PASSWORD` and `APP_PASSWORD`. Both are safe to re-run. Script 01
never changes an existing login's password.

**CI** runs them through `node backend/scripts/run-sql.js` (see
`.github/actions/setup-sqlserver`), with passwords generated for each run.

**Locally**, as a Windows administrator of the SQL Server instance:

1. Create any missing login in SSMS so its password is never typed on a command line or saved
   in shell history, for example:
   ```sql
   CREATE LOGIN poc_migrator WITH PASSWORD = '<strong password>', DEFAULT_DATABASE = HelloPoc;
   ```
2. Apply database access (no passwords involved):
   ```bash
   sqlcmd -S localhost -E -C -i database/bootstrap/02_database_access.sql -v DB_NAME=HelloPoc MIGRATOR_LOGIN=poc_migrator APP_LOGIN=poc_app
   ```
3. Put both logins in `.env` (`DB_USER`/`DB_PASSWORD` and
   `DB_MIGRATION_USER`/`DB_MIGRATION_PASSWORD`), then run `npm run db:migrate`.

## Migrations

Numbered scripts in `migrations/` are applied in order by `npm run db:migrate` as the migration
identity. Each runs in a transaction and is recorded in `dbo.SchemaVersion`, so re-running only
applies new scripts. Separate batches with `GO` lines. Never edit an applied script; add a new
one.
