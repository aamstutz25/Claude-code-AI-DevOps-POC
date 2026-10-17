import { createApp } from './app.js';
import { getConfig, loadEnvFile } from './config.js';
import { createCredentialProvider } from './db/credentials.js';
import { createDatabase } from './db/pool.js';
import { createLogger } from './logger.js';

loadEnvFile();
const config = getConfig();
const logger = createLogger({ level: config.logLevel });

// The running app only ever uses the least-privilege runtime identity.
const credentialProvider = createCredentialProvider(config.db.credentialProvider, {
  envFile: config.envFile,
  purpose: 'runtime',
});
const db = createDatabase({ dbConfig: config.db, credentialProvider, logger });
const app = createApp({ config, db, logger });

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      dbServer: `${config.db.server}:${config.db.port}`,
      database: config.db.database,
      credentialProvider: credentialProvider.name,
      trustServerCertificate: config.db.trustServerCertificate,
    },
    `API listening on http://localhost:${config.port}`,
  );
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await db.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
