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

describe('credential purposes (separate identities)', () => {
  let dir;
  let envFile;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hello-poc-purpose-'));
    envFile = join(dir, '.env');
    writeFileSync(
      envFile,
      'DB_USER=poc_app\nDB_PASSWORD=app-secret\nDB_MIGRATION_USER=poc_migrator\nDB_MIGRATION_PASSWORD=migrator-secret\n',
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('defaults to the runtime identity', async () => {
    const provider = createCredentialProvider('env', { envFile, env: {} });
    expect(provider.purpose).toBe('runtime');
    await expect(provider.getCredentials()).resolves.toEqual({
      user: 'poc_app',
      password: 'app-secret',
    });
  });

  it('returns the separate migration identity for migrations', async () => {
    const provider = createCredentialProvider('env', { envFile, env: {}, purpose: 'migration' });
    await expect(provider.getCredentials()).resolves.toEqual({
      user: 'poc_migrator',
      password: 'migrator-secret',
    });
  });

  it('never falls back from migration to runtime credentials', async () => {
    writeFileSync(envFile, 'DB_USER=poc_app\nDB_PASSWORD=app-secret\n');
    const provider = createCredentialProvider('env', { envFile, env: {}, purpose: 'migration' });
    await expect(provider.getCredentials()).rejects.toThrow(
      'Database credentials are not configured: set DB_MIGRATION_USER and DB_MIGRATION_PASSWORD',
    );
  });

  it('rejects an unknown purpose', () => {
    expect(() => createCredentialProvider('env', { purpose: 'admin' })).toThrow(
      'Unknown credential purpose "admin". Available: runtime, migration',
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
