# Claude-code-AI-DevOps-POC

DevOps proof of concept: React frontend, Node.js + Express backend, Microsoft SQL Server database.

**Phase 1** runs entirely on a local Windows development laptop and delivers an end-to-end
Hello World: the React page calls the Express API, which reads the greeting from SQL Server.

```
Browser ── http://localhost:5173 ──► React (Vite dev server)
                                       │  /api/* proxied
                                       ▼
                              Express API :3000 ──TCP 1433──► SQL Server (HelloPoc)
                                       ▲
                              credential provider (.env now → PAM later)
```

In production mode (`npm run build` then `npm start`) Express serves the built React app
and the API together on port 3000.

## Prerequisites

| Software                         | Version used           |
| -------------------------------- | ---------------------- |
| Node.js (includes npm)           | 24 LTS                 |
| Git                              | 2.55+                  |
| SQL Server (Developer Edition)   | 2025, TCP/IP on 1433   |
| SQL Server login mode            | SQL Server and Windows |
| VS Code + recommended extensions | see `.vscode/`         |
| SQL Server Management Studio     | 22 (optional)          |

The database `HelloPoc` and a SQL login with `db_owner` on it (Phase 1: `poc_app`) must exist.

> **PowerShell users:** if `npm` reports _"running scripts is disabled on this system"_, run
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use Command
> Prompt.

## Getting started

```bash
npm install
copy .env.example .env      # then set DB_PASSWORD in .env
npm run db:migrate          # creates and seeds the tables (safe to re-run)
npm run dev                 # API on :3000, React on :5173
```

Open http://localhost:5173: it shows **Hello, World!** and "Database connected".

> In `.env`, wrap the password in single quotes (`DB_PASSWORD='...'`). Unquoted, anything after
> a `#` is treated as a comment and the password is silently cut short.

## Scripts

| Command                     | What it does                                                  |
| --------------------------- | ------------------------------------------------------------- |
| `npm run dev`               | Runs the API (auto-restart) and the React dev server together |
| `npm run build`             | Builds the React app into `frontend/dist`                     |
| `npm start`                 | Runs the API, serving the React build if it exists            |
| `npm run db:migrate`        | Applies new scripts from `database/migrations`                |
| `npm run lint`              | ESLint over the whole repository                              |
| `npm run format` / `:check` | Prettier: fix / check formatting                              |
| `npm test`                  | Backend and frontend unit tests (no database needed)          |
| `npm run test:integration`  | Tests against the real SQL Server in `.env` (migrate first)   |

## API

| Endpoint            | Response                                                                             |
| ------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/greeting` | `200 { "message": "Hello, World!" }`                                                 |
| `GET /api/health`   | `200 { "status": "ok", "db": "up" }` or `503 { "status": "degraded", "db": "down" }` |

Errors return `{ "error": "..." }` with no internal details.

## Configuration

All settings come from environment variables. Locally they are read from `.env` at the
repository root (git-ignored); variables already set in the environment take precedence, so
a pipeline can supply them directly. See `.env.example` for the full list.

| Variable                      | Default                 | Notes                              |
| ----------------------------- | ----------------------- | ---------------------------------- |
| `PORT`                        | `3000`                  | API port                           |
| `CORS_ORIGIN`                 | `http://localhost:5173` | The only browser origin allowed    |
| `LOG_LEVEL`                   | `info`                  | pino log level                     |
| `DB_SERVER` / `DB_PORT`       | `localhost` / `1433`    |                                    |
| `DB_NAME`                     | `HelloPoc`              |                                    |
| `DB_ENCRYPT`                  | `true`                  | Encrypts the SQL Server connection |
| `DB_TRUST_SERVER_CERTIFICATE` | `false`                 | See below                          |
| `DB_CREDENTIAL_PROVIDER`      | `env`                   | See below                          |
| `DB_USER` / `DB_PASSWORD`     | none                    | Read only by the `env` provider    |
| `DB_LOGIN_COOLDOWN_SECONDS`   | `300`                   | Lockout protection (see below)     |

### `DB_TRUST_SERVER_CERTIFICATE`

Local Phase 1 development sets this to `true` so the app accepts SQL Server's self-signed
certificate. **This is not the TEST/PROD standard.** TEST and PROD must present a certificate
from a trusted authority and run with `DB_TRUST_SERVER_CERTIFICATE=false` (the code default),
so the connection is both encrypted and verified.

## Credentials and future PAM integration

Database credentials are read in exactly one place: `backend/src/db/credentials.js`. Every
credential provider implements one function:

```js
getCredentials(): Promise<{ user, password }>
```

- **Phase 1** implements only the `env` provider: a single SQL login (`DB_USER` /
  `DB_PASSWORD`). It re-reads `.env` on every call, so a changed password is picked up without
  restarting the app.
- The connection pool (`backend/src/db/pool.js`) asks the provider for credentials whenever it
  opens a pool. If SQL Server rejects the login (error 18456), the pool is closed, credentials
  are fetched again and the operation is retried once. This is what lets an external PAM
  solution rotate the password while the app is running.
- **Lockout protection:** SQL logins follow the Windows account-lockout policy, so repeated
  failures can lock the login. After a failed login the pool will not send those same
  credentials to SQL Server again for `DB_LOGIN_COOLDOWN_SECONDS` (default 300); requests
  fail fast instead. Changed (rotated) credentials are tried immediately, so recovery from a
  rotation is not delayed, and each rotation costs SQL Server at most one failed login.
  Restarting the app also clears the cooldown.
- **To integrate PAM later:** add a provider (for example `pam`) to `credentials.js` that
  fetches the credentials from the PAM solution, and set `DB_CREDENTIAL_PROVIDER=pam`. No
  routes, pool or startup code change. A two-account (zero-downtime) rotation strategy can be
  added in that provider and pool later; Phase 1 deliberately does not implement it.
- Credentials are never committed, never part of the config object, and redacted from logs;
  errors are logged as name, code and message only.

## Database migrations

Numbered scripts in `database/migrations` (`001_create_greeting.sql`, ...) are applied in
order by `npm run db:migrate`. Each runs in a transaction and is recorded in
`dbo.SchemaVersion`, so re-running applies only new scripts. Separate batches with `GO` lines.
Never edit a script that has already been applied; add a new one.

## Project layout

```
backend/              Express API
  src/app.js          routes and middleware (built from injected dependencies for testing)
  src/server.js       startup and graceful shutdown
  src/config.js       settings from environment variables
  src/db/             credential provider and rotation-aware connection pool
  scripts/migrate.js  migration runner
  test/unit/          unit tests (no database)
  test/integration/   tests against the real database
frontend/             React + Vite
database/migrations/  SQL migration scripts
```

## Phase 1 scope

Out of scope: sign-in, containers, CI/CD pipelines, cloud deployment, HTTPS and the PAM
integration itself (only its plug-in point exists).
