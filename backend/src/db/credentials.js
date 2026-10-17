import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Credential provider abstraction.
 *
 * This module is the only place in the application that reads database credentials.
 * Every provider exposes the same interface:
 *
 *   getCredentials(): Promise<{ user: string, password: string }>
 *
 * The connection pool calls getCredentials() each time it opens a new pool, including
 * after a login failure, so a rotated password is picked up without restarting the app.
 *
 * Phase 1 implements only the "env" provider (a single local SQL login). A future PAM
 * provider is added to `providers` below and selected with DB_CREDENTIAL_PROVIDER; no
 * other part of the application needs to change.
 */

/**
 * Reads DB_USER and DB_PASSWORD from the .env file on every call (so edits take effect
 * immediately), falling back to process environment variables when the file or a value
 * is missing (for example in a pipeline).
 */
function createEnvProvider({ envFile, env }) {
  return {
    name: 'env',
    async getCredentials() {
      const fromFile =
        envFile && existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
      const user = fromFile.DB_USER || env.DB_USER;
      const password = fromFile.DB_PASSWORD || env.DB_PASSWORD;
      if (!user || !password) {
        throw new Error('Database credentials are not configured: set DB_USER and DB_PASSWORD');
      }
      return { user, password };
    },
  };
}

const providers = {
  env: createEnvProvider,
};

export function createCredentialProvider(name, { envFile, env = process.env } = {}) {
  const factory = providers[name];
  if (!factory) {
    throw new Error(
      `Unknown DB_CREDENTIAL_PROVIDER "${name}". Available: ${Object.keys(providers).join(', ')}`,
    );
  }
  return factory({ envFile, env });
}
