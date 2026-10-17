import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import sql from 'mssql';
import { describeError } from '../logger.js';

const scrypt = promisify(scryptCallback);

/** SQL Server error 18456 ("Login failed for user") and the driver's matching code. */
export function isLoginFailure(err) {
  return err?.code === 'ELOGIN' || err?.number === 18456 || err?.originalError?.number === 18456;
}

/** Raised instead of contacting SQL Server while known-bad credentials are cooling down. */
export class LoginCooldownError extends Error {
  constructor() {
    super('Database login recently failed with these credentials; waiting for new credentials');
    this.name = 'LoginCooldownError';
    this.code = 'ELOGINCOOLDOWN';
  }
}

/**
 * Identifies a set of credentials without keeping another copy of the password. Uses
 * scrypt (a password-hashing function) with a random salt that exists only in this
 * process, so the fingerprint is useless outside it. It runs only when a pool opens.
 */
function createFingerprinter() {
  const salt = randomBytes(16);
  return ({ user, password }) => scrypt(`${user}\0${password}`, salt, 32);
}

function sameFingerprint(a, b) {
  return Boolean(a && b) && timingSafeEqual(a, b);
}

/**
 * Wraps an mssql connection pool so credentials come from the credential provider and
 * a login failure (for example after a password rotation) is recovered automatically:
 * the pool is closed, credentials are fetched again and the operation is retried once.
 *
 * To avoid locking the SQL login out (SQL logins follow the Windows lockout policy), a
 * login failure puts those exact credentials on a cooldown: until it ends they are not
 * sent to SQL Server again. Different (rotated) credentials are tried immediately.
 */
export function createDatabase({
  dbConfig,
  credentialProvider,
  logger,
  sqlClient = sql,
  now = Date.now,
}) {
  const loginCooldownMs = (dbConfig.loginCooldownSeconds ?? 300) * 1000;
  const fingerprint = createFingerprinter();
  let poolPromise = null;
  let poolCredentialsId = null; // fingerprint of the credentials the open pool uses
  let failedLogin = null; // { fingerprint, until }

  function startCooldown(credentialsId) {
    failedLogin = { fingerprint: credentialsId, until: now() + loginCooldownMs };
    logger.warn(
      { cooldownSeconds: loginCooldownMs / 1000 },
      'Database login failed; these credentials will not be retried until the cooldown ends',
    );
  }

  async function openPool() {
    const credentials = await credentialProvider.getCredentials();
    const credentialsId = await fingerprint(credentials);
    if (sameFingerprint(failedLogin?.fingerprint, credentialsId) && now() < failedLogin.until) {
      throw new LoginCooldownError();
    }

    const pool = new sqlClient.ConnectionPool({
      server: dbConfig.server,
      port: dbConfig.port,
      database: dbConfig.database,
      user: credentials.user,
      password: credentials.password,
      options: {
        encrypt: dbConfig.encrypt,
        trustServerCertificate: dbConfig.trustServerCertificate,
      },
      pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
      connectionTimeout: 15_000,
      requestTimeout: 15_000,
    });
    pool.on('error', (err) => logger.error({ err: describeError(err) }, 'Database pool error'));
    try {
      await pool.connect();
    } catch (err) {
      if (isLoginFailure(err)) startCooldown(credentialsId);
      throw err;
    }
    failedLogin = null;
    poolCredentialsId = credentialsId;
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
    poolCredentialsId = null;
    if (!current) return;
    try {
      await (await current).close();
    } catch {
      // The pool never opened or is already closed; nothing to release.
    }
  }

  /**
   * Runs `operation(pool)`, retrying once with fresh credentials after a login failure.
   * The credentials that just failed go on cooldown first, so the retry only reaches
   * SQL Server if the credential source already has different (rotated) credentials.
   */
  async function run(operation) {
    try {
      return await operation(await getPool());
    } catch (err) {
      if (!isLoginFailure(err)) throw err;
      if (poolCredentialsId) startCooldown(poolCredentialsId);
      logger.warn('Database login failed; reloading credentials and retrying once');
      await close();
      return operation(await getPool());
    }
  }

  return { run, close };
}
