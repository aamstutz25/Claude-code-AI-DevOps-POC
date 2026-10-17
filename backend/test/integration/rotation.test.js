// Live password-rotation test. It needs an administrator login (DB_ADMIN_USER /
// DB_ADMIN_PASSWORD) to create a temporary login, rotate its password and drop it again,
// so it runs in CI and is skipped elsewhere unless those variables are set deliberately.
// The application's own logins are never touched.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sql from 'mssql';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getConfig, loadEnvFile } from '../../src/config.js';
import { createCredentialProvider } from '../../src/db/credentials.js';
import { createDatabase } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';

loadEnvFile();
const { DB_ADMIN_USER: adminUser, DB_ADMIN_PASSWORD: adminPassword } = process.env;

describe.skipIf(!adminUser || !adminPassword)('password rotation against SQL Server', () => {
  const config = getConfig();
  const login = `poc_rotation_${randomBytes(4).toString('hex')}`;
  const newPassword = () => `Rt#${randomBytes(18).toString('base64url')}`;
  const firstPassword = newPassword();
  const rotatedPassword = newPassword();
  const workDir = mkdtempSync(join(tmpdir(), 'hello-poc-rotation-'));
  const envFile = join(workDir, '.env');
  const logLines = [];
  const startedAt = new Date();
  let admin;
  let db;
  let app;

  const writeCredentials = (password) =>
    writeFileSync(envFile, `DB_USER=${login}\nDB_PASSWORD='${password}'\n`);

  // Parameterised statements go through query() (sp_executesql); plain ones through
  // batch() so USE carries over on the single admin connection.
  const adminQuery = (text, inputs) => {
    const req = admin.request();
    if (!inputs) return req.batch(text);
    for (const [name, value] of Object.entries(inputs)) req.input(name, value);
    return req.query(text);
  };

  const killSessions = () =>
    adminQuery(
      `DECLARE @statement nvarchar(max) = N'';
       SELECT @statement += N'KILL ' + CAST(session_id AS nvarchar(10)) + N';'
       FROM sys.dm_exec_sessions WHERE login_name = @login;
       EXEC (@statement);`,
      { login },
    );

  const health = () => request(app).get('/api/health');

  beforeAll(async () => {
    admin = await new sql.ConnectionPool({
      server: config.db.server,
      port: config.db.port,
      database: 'master',
      user: adminUser,
      password: adminPassword,
      options: {
        encrypt: config.db.encrypt,
        trustServerCertificate: config.db.trustServerCertificate,
      },
      pool: { min: 1, max: 1 },
    }).connect();

    // The login name is generated above, so it is safe to place in the statement.
    await adminQuery(
      `CREATE LOGIN [${login}] WITH PASSWORD = N'${firstPassword}', CHECK_POLICY = OFF,
         DEFAULT_DATABASE = [${config.db.database}];`,
    );
    await adminQuery(
      `USE [${config.db.database}];
       CREATE USER [${login}] FOR LOGIN [${login}];
       ALTER ROLE app_runtime ADD MEMBER [${login}];`,
    );
    writeCredentials(firstPassword);

    const logger = createLogger({
      level: 'info',
      destination: { write: (line) => logLines.push(line) },
    });
    db = createDatabase({
      dbConfig: config.db,
      credentialProvider: createCredentialProvider('env', { envFile, env: {} }),
      logger,
    });
    app = createApp({ config, db, logger });
  });

  afterAll(async () => {
    await db?.close();
    if (admin) {
      await killSessions().catch(() => {});
      await adminQuery(
        `USE [${config.db.database}];
         IF DATABASE_PRINCIPAL_ID(N'${login}') IS NOT NULL DROP USER [${login}];
         USE master;
         IF SUSER_ID(N'${login}') IS NOT NULL DROP LOGIN [${login}];`,
      );
      await admin.close();
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it('recovers in the same process after the password is rotated', async () => {
    expect((await health()).status).toBe(200);

    // The PAM solution rotates the password and existing sessions end.
    await adminQuery(`ALTER LOGIN [${login}] WITH PASSWORD = N'${rotatedPassword}';`);
    await killSessions();

    // The app still holds the old password: it reports the database down...
    expect((await health()).status).toBe(503);
    // ...and stops sending the failed password while it cools down.
    expect((await health()).status).toBe(503);

    // The new password reaches the credential source; no restart.
    writeCredentials(rotatedPassword);
    const recovered = await health();
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('costs SQL Server at most one failed login (lockout protection)', async () => {
    await delay(1000); // let SQL Server write its error log
    const result = await adminQuery(
      `CREATE TABLE #log (LogDate datetime, ProcessInfo nvarchar(64), Text nvarchar(max));
       INSERT #log EXEC xp_readerrorlog 0, 1, @login, N'Password did not match', @since, NULL;
       SELECT COUNT(*) AS failures FROM #log;`,
      { login, since: startedAt },
    );
    expect(result.recordset[0].failures).toBeLessThanOrEqual(1);
  });

  it('never writes either password to the log', () => {
    const output = logLines.join('');
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain(firstPassword);
    expect(output).not.toContain(rotatedPassword);
  });
});
