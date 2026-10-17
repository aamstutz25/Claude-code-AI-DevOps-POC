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
 * Credentials are requested for a purpose, and each purpose is a separate SQL identity:
 *   - "runtime":   the application's least-privilege login (role app_runtime)
 *   - "migration": the deployment login that applies schema changes (db_owner of the
 *                  application database only). The running application never asks for it.
 *
 * Phase 1 implements only the "env" provider (one login per purpose). A future PAM
 * provider is added to `providers` below and selected with DB_CREDENTIAL_PROVIDER; no
 * other part of the application needs to change.
 */

/** Environment variable names holding each purpose's login. */
export const credentialKeys = {
  runtime: { user: 'DB_USER', password: 'DB_PASSWORD' },
  migration: { user: 'DB_MIGRATION_USER', password: 'DB_MIGRATION_PASSWORD' },
};

/**
 * Reads the purpose's login from the .env file on every call (so edits take effect
 * immediately), falling back to process environment variables when the file or a value
 * is missing (for example in a pipeline).
 */
function createEnvProvider({ envFile, env, purpose }) {
  const keys = credentialKeys[purpose];
  return {
    name: 'env',
    purpose,
    async getCredentials() {
      const fromFile =
        envFile && existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
      const user = fromFile[keys.user] || env[keys.user];
      const password = fromFile[keys.password] || env[keys.password];
      if (!user || !password) {
        throw new Error(
          `Database credentials are not configured: set ${keys.user} and ${keys.password}`,
        );
      }
      return { user, password };
    },
  };
}

const providers = {
  env: createEnvProvider,
};

export function createCredentialProvider(
  name,
  { envFile, env = process.env, purpose = 'runtime' } = {},
) {
  const factory = providers[name];
  if (!factory) {
    throw new Error(
      `Unknown DB_CREDENTIAL_PROVIDER "${name}". Available: ${Object.keys(providers).join(', ')}`,
    );
  }
  if (!credentialKeys[purpose]) {
    throw new Error(
      `Unknown credential purpose "${purpose}". Available: ${Object.keys(credentialKeys).join(', ')}`,
    );
  }
  return factory({ envFile, env, purpose });
}
