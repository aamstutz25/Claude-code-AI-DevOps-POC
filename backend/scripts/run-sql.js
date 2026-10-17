// Runs an administrative SQL script (database bootstrap) the way sqlcmd does: $(NAME)
// variables come from environment variables and GO lines separate batches. CI uses this
// so it does not depend on sqlcmd being installed.
//
// Connects as DB_ADMIN_USER / DB_ADMIN_PASSWORD, never as the application or migration
// login. Server and encryption settings come from the usual DB_* settings.
//
// Usage: node backend/scripts/run-sql.js <script.sql>

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import sql from 'mssql';
import { getConfig, loadEnvFile } from '../src/config.js';
import { splitBatches, substituteVariables } from '../src/db/sql-script.js';
import { createLogger, describeError } from '../src/logger.js';

/** Connects, retrying while SQL Server is still starting (for example a new container). */
async function connectWithRetry(poolConfig, logger, attempts = 30) {
  for (let attempt = 1; ; attempt += 1) {
    const pool = new sql.ConnectionPool(poolConfig);
    try {
      return await pool.connect();
    } catch (err) {
      if (attempt >= attempts) throw err;
      logger.info({ attempt, err: describeError(err) }, 'SQL Server not ready; retrying');
      await delay(2000);
    }
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    throw new Error('Usage: node backend/scripts/run-sql.js <script.sql>');
  }
  loadEnvFile();
  const config = getConfig();
  const logger = createLogger({ level: config.logLevel });
  const { DB_ADMIN_USER: user, DB_ADMIN_PASSWORD: password } = process.env;
  if (!user || !password) {
    throw new Error('Set DB_ADMIN_USER and DB_ADMIN_PASSWORD to run administrative scripts');
  }

  const batches = splitBatches(substituteVariables(readFileSync(file, 'utf8'), process.env));
  const pool = await connectWithRetry(
    {
      server: config.db.server,
      port: config.db.port,
      database: 'master',
      user,
      password,
      options: {
        encrypt: config.db.encrypt,
        trustServerCertificate: config.db.trustServerCertificate,
      },
      // One connection, so session state such as USE carries across batches.
      pool: { min: 1, max: 1 },
    },
    logger,
  );
  try {
    for (const batch of batches) {
      await pool.request().batch(batch);
    }
    logger.info({ script: file, batches: batches.length }, 'SQL script applied');
  } finally {
    await pool.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    createLogger().error({ err: describeError(err) }, 'SQL script failed');
    process.exitCode = 1;
  }
}
