import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getConfig, loadEnvFile } from '../../src/config.js';
import { createCredentialProvider } from '../../src/db/credentials.js';
import { createDatabase } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';

loadEnvFile();
const config = getConfig();
const logger = createLogger({ level: 'silent' });
const runtimeCredentials = createCredentialProvider(config.db.credentialProvider, {
  envFile: config.envFile,
  purpose: 'runtime',
});
const migrationCredentials = createCredentialProvider(config.db.credentialProvider, {
  envFile: config.envFile,
  purpose: 'migration',
});
const db = createDatabase({ dbConfig: config.db, credentialProvider: runtimeCredentials, logger });
const app = createApp({ config, db, logger });

afterAll(() => db.close());

describe('against the real SQL Server', () => {
  it('connects over TCP with the configured login', async () => {
    // CONNECTIONPROPERTY needs no server-level permission, unlike sys.dm_exec_connections.
    const result = await db.run((pool) =>
      pool
        .request()
        .query(
          "SELECT DB_NAME() AS db, CAST(CONNECTIONPROPERTY('net_transport') AS nvarchar(40)) AS transport",
        ),
    );
    expect(result.recordset[0]).toEqual({ db: config.db.database, transport: 'TCP' });
  });

  it('GET /api/health reports the database as up', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /api/greeting returns the seeded greeting', async () => {
    const res = await request(app).get('/api/greeting');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello, World!' });
  });
});

describe('runtime identity follows least privilege', () => {
  it('is a different login from the migration identity', async () => {
    const runtime = await runtimeCredentials.getCredentials();
    const migration = await migrationCredentials.getCredentials();
    expect(runtime.user).not.toBe(migration.user);
  });

  it('has only the permissions the application needs', async () => {
    const result = await db.run((pool) =>
      pool.request().query(`
        SELECT
          IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
          IS_ROLEMEMBER('db_owner') AS dbOwner,
          IS_ROLEMEMBER('db_ddladmin') AS ddlAdmin,
          IS_ROLEMEMBER('db_datawriter') AS dataWriter,
          IS_ROLEMEMBER('app_runtime') AS appRuntime,
          HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS createTable,
          HAS_PERMS_BY_NAME('dbo.Greeting', 'OBJECT', 'SELECT') AS selectGreeting,
          HAS_PERMS_BY_NAME('dbo.Greeting', 'OBJECT', 'INSERT') AS insertGreeting,
          HAS_PERMS_BY_NAME('dbo.Greeting', 'OBJECT', 'UPDATE') AS updateGreeting,
          HAS_PERMS_BY_NAME('dbo.Greeting', 'OBJECT', 'DELETE') AS deleteGreeting,
          HAS_PERMS_BY_NAME('dbo.SchemaVersion', 'OBJECT', 'SELECT') AS readSchemaVersion`),
    );
    expect(result.recordset[0]).toEqual({
      sysadmin: 0,
      dbOwner: 0,
      ddlAdmin: 0,
      dataWriter: 0,
      appRuntime: 1,
      createTable: 0,
      selectGreeting: 1,
      insertGreeting: 0,
      updateGreeting: 0,
      deleteGreeting: 0,
      readSchemaVersion: 0,
    });
  });

  it('is refused when it tries to change data or schema', async () => {
    await expect(
      db.run((pool) => pool.request().query("INSERT INTO dbo.Greeting (Message) VALUES (N'x')")),
    ).rejects.toThrow(/permission was denied/i);
    await expect(
      db.run((pool) => pool.request().query('CREATE TABLE dbo.ShouldNotExist (Id INT)')),
    ).rejects.toThrow(/permission denied/i);
  });
});
