import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCredentialProvider } from '../../src/db/credentials.js';

describe('env credential provider', () => {
  let dir;
  let envFile;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hello-poc-creds-'));
    envFile = join(dir, '.env');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the login from the .env file', async () => {
    writeFileSync(envFile, 'DB_USER=poc_app\nDB_PASSWORD=first-secret\n');
    const provider = createCredentialProvider('env', { envFile, env: {} });
    await expect(provider.getCredentials()).resolves.toEqual({
      user: 'poc_app',
      password: 'first-secret',
    });
  });

  it('picks up a changed password without being recreated (rotation)', async () => {
    writeFileSync(envFile, 'DB_USER=poc_app\nDB_PASSWORD=first-secret\n');
    const provider = createCredentialProvider('env', { envFile, env: {} });
    await provider.getCredentials();
    writeFileSync(envFile, 'DB_USER=poc_app\nDB_PASSWORD=rotated-secret\n');
    await expect(provider.getCredentials()).resolves.toMatchObject({ password: 'rotated-secret' });
  });

  it('falls back to environment variables when the file is missing', async () => {
    const provider = createCredentialProvider('env', {
      envFile: join(dir, 'missing.env'),
      env: { DB_USER: 'ci_user', DB_PASSWORD: 'ci-secret' },
    });
    await expect(provider.getCredentials()).resolves.toEqual({
      user: 'ci_user',
      password: 'ci-secret',
    });
  });

  it('fails clearly, without echoing values, when the password is missing', async () => {
    writeFileSync(envFile, 'DB_USER=poc_app\nDB_PASSWORD=\n');
    const provider = createCredentialProvider('env', { envFile, env: {} });
    await expect(provider.getCredentials()).rejects.toThrow(
      'Database credentials are not configured: set DB_USER and DB_PASSWORD',
    );
  });
});

describe('createCredentialProvider', () => {
  it('rejects an unknown provider and lists the available ones', () => {
    expect(() => createCredentialProvider('pam')).toThrow(
      'Unknown DB_CREDENTIAL_PROVIDER "pam". Available: env',
    );
  });
});
