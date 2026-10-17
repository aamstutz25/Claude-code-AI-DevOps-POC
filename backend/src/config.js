import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultEnvFile = resolve(repoRoot, '.env');

/**
 * Loads settings from the .env file into process.env, if the file exists.
 * Variables already set in the environment (for example by a pipeline) take precedence.
 */
export function loadEnvFile(envFile = process.env.ENV_FILE ?? defaultEnvFile) {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  return envFile;
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number between 1 and 65535`);
  }
  return port;
}

function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a whole number of 1 or more`);
  }
  return number;
}

function parseNonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a whole number of 0 or more`);
  }
  return number;
}

function parseBoolean(value, defaultValue, name) {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

/**
 * Builds the application settings from environment variables.
 * Credentials are deliberately not part of this object: they are read on demand by the
 * credential provider so they can change (be rotated) while the app is running.
 */
export function getConfig(env = process.env) {
  return {
    port: parsePort(env.PORT ?? '3000', 'PORT'),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    logLevel: env.LOG_LEVEL ?? 'info',
    // Requests per minute allowed from one client IP, across the API and the web app.
    rateLimitPerMinute: parsePositiveInteger(
      env.RATE_LIMIT_PER_MINUTE ?? '300',
      'RATE_LIMIT_PER_MINUTE',
    ),
    envFile: env.ENV_FILE ?? defaultEnvFile,
    db: {
      server: env.DB_SERVER ?? 'localhost',
      port: parsePort(env.DB_PORT ?? '1433', 'DB_PORT'),
      database: env.DB_NAME ?? 'HelloPoc',
      encrypt: parseBoolean(env.DB_ENCRYPT, true, 'DB_ENCRYPT'),
      // Secure default. Only local Phase 1 development sets this to true (see .env.example).
      trustServerCertificate: parseBoolean(
        env.DB_TRUST_SERVER_CERTIFICATE,
        false,
        'DB_TRUST_SERVER_CERTIFICATE',
      ),
      credentialProvider: env.DB_CREDENTIAL_PROVIDER ?? 'env',
      // After a failed login, the same credentials are not retried for this long, so a
      // wrong password cannot lock the SQL login out. Changed credentials are tried at once.
      loginCooldownSeconds: parseNonNegativeInteger(
        env.DB_LOGIN_COOLDOWN_SECONDS ?? '300',
        'DB_LOGIN_COOLDOWN_SECONDS',
      ),
    },
  };
}
