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
const db = createDatabase({
  dbConfig: config.db,
  credentialProvider: createCredentialProvider(config.db.credentialProvider, {
    envFile: config.envFile,
  }),
  logger,
});
const app = createApp({ config, db, logger });

afterAll(() => db.close());

describe('against the real SQL Server', () => {
  it('connects over TCP with the configured login', async () => {
    const result = await db.run((pool) =>
      pool
        .request()
        .query(
          'SELECT SUSER_SNAME() AS login, DB_NAME() AS db, net_transport AS transport FROM sys.dm_exec_connections WHERE session_id = @@SPID',
        ),
    );
    expect(result.recordset[0]).toMatchObject({ db: config.db.database, transport: 'TCP' });
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
