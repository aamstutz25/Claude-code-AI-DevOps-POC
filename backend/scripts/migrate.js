// Applies numbered SQL scripts from database/migrations in order and records each one in
// dbo.SchemaVersion, so running it again only applies new scripts (safe for pipelines).
//
// Usage: npm run db:migrate

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { getConfig, loadEnvFile } from '../src/config.js';
import { createCredentialProvider } from '../src/db/credentials.js';
import { createDatabase } from '../src/db/pool.js';
import { createLogger, describeError } from '../src/logger.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../database/migrations');

/** Splits a script into batches on lines containing only GO, like sqlcmd and SSMS. */
export function splitBatches(script) {
  return script
    .split(/^\s*GO\s*$/im)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

const ensureVersionTable = `
IF OBJECT_ID(N'dbo.SchemaVersion', N'U') IS NULL
    CREATE TABLE dbo.SchemaVersion (
        Version NVARCHAR(255) NOT NULL CONSTRAINT PK_SchemaVersion PRIMARY KEY,
        AppliedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SchemaVersion_AppliedAt DEFAULT SYSUTCDATETIME()
    );`;

async function migrate(pool, logger) {
  await pool.request().batch(ensureVersionTable);
  const applied = new Set(
    (await pool.request().query('SELECT Version FROM dbo.SchemaVersion')).recordset.map(
      (row) => row.Version,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    logger.info('Database is up to date');
    return;
  }

  for (const file of pending) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const batch of splitBatches(readFileSync(join(migrationsDir, file), 'utf8'))) {
        await new sql.Request(transaction).batch(batch);
      }
      await new sql.Request(transaction)
        .input('version', sql.NVarChar(255), file)
        .query('INSERT INTO dbo.SchemaVersion (Version) VALUES (@version)');
      await transaction.commit();
      logger.info({ migration: file }, 'Applied migration');
    } catch (err) {
      await transaction.rollback();
      throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
    }
  }
}

async function main() {
  loadEnvFile();
  const config = getConfig();
  const logger = createLogger({ level: config.logLevel });
  const credentialProvider = createCredentialProvider(config.db.credentialProvider, {
    envFile: config.envFile,
  });
  const db = createDatabase({ dbConfig: config.db, credentialProvider, logger });
  try {
    await db.run((pool) => migrate(pool, logger));
  } catch (err) {
    logger.error({ err: describeError(err) }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
