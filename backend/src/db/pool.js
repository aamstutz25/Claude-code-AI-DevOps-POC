import sql from 'mssql';
import { describeError } from '../logger.js';

/** SQL Server error 18456 ("Login failed for user") and the driver's matching code. */
export function isLoginFailure(err) {
  return err?.code === 'ELOGIN' || err?.number === 18456 || err?.originalError?.number === 18456;
}

/**
 * Wraps an mssql connection pool so credentials come from the credential provider and
 * a login failure (for example after a password rotation) is recovered automatically:
 * the pool is closed, credentials are fetched again and the operation is retried once.
 */
export function createDatabase({ dbConfig, credentialProvider, logger, sqlClient = sql }) {
  let poolPromise = null;

  async function openPool() {
    const { user, password } = await credentialProvider.getCredentials();
    const pool = new sqlClient.ConnectionPool({
      server: dbConfig.server,
      port: dbConfig.port,
      database: dbConfig.database,
      user,
      password,
      options: {
        encrypt: dbConfig.encrypt,
        trustServerCertificate: dbConfig.trustServerCertificate,
      },
      pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
      connectionTimeout: 15_000,
      requestTimeout: 15_000,
    });
    pool.on('error', (err) => logger.error({ err: describeError(err) }, 'Database pool error'));
    await pool.connect();
    return pool;
  }

  function getPool() {
    if (!poolPromise) {
      poolPromise = openPool().catch((err) => {
        poolPromise = null;
        throw err;
      });
    }
    return poolPromise;
  }

  async function close() {
    const current = poolPromise;
    poolPromise = null;
    if (!current) return;
    try {
      await (await current).close();
    } catch {
      // The pool never opened or is already closed; nothing to release.
    }
  }

  /** Runs `operation(pool)`, retrying once with fresh credentials after a login failure. */
  async function run(operation) {
    try {
      return await operation(await getPool());
    } catch (err) {
      if (!isLoginFailure(err)) throw err;
      logger.warn('Database login failed; reloading credentials and retrying once');
      await close();
      return operation(await getPool());
    }
  }

  return { run, close };
}
