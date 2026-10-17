import { describe, expect, it, vi } from 'vitest';
import { createDatabase, isLoginFailure } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';

const dbConfig = {
  server: 'localhost',
  port: 1433,
  database: 'HelloPoc',
  encrypt: true,
  trustServerCertificate: true,
};
const logger = createLogger({ level: 'silent' });

function loginError() {
  return Object.assign(new Error("Login failed for user 'poc_app'."), { code: 'ELOGIN' });
}

/** Builds a fake mssql client that records every pool it creates. */
function fakeSqlClient({ failConnectFor = [] } = {}) {
  const pools = [];
  class ConnectionPool {
    constructor(config) {
      this.config = config;
      this.closed = false;
      pools.push(this);
    }
    on() {}
    async connect() {
      if (failConnectFor.includes(this.config.password)) throw loginError();
      return this;
    }
    async close() {
      this.closed = true;
    }
  }
  return { pools, client: { ConnectionPool } };
}

/** A credential provider returning the given passwords in turn (the last one repeats). */
function rotatingProvider(...passwords) {
  let call = 0;
  return {
    getCredentials: vi.fn(async () => ({
      user: 'poc_app',
      password: passwords[Math.min(call++, passwords.length - 1)],
    })),
  };
}

function makeDb(provider, sqlClient) {
  return createDatabase({ dbConfig, credentialProvider: provider, logger, sqlClient });
}

describe('createDatabase', () => {
  it('opens the pool with the configured settings and provider credentials', async () => {
    const { pools, client } = fakeSqlClient();
    const db = makeDb(rotatingProvider('pw-1'), client);
    await db.run(async () => 'ok');
    expect(pools[0].config).toMatchObject({
      server: 'localhost',
      port: 1433,
      database: 'HelloPoc',
      user: 'poc_app',
      password: 'pw-1',
      options: { encrypt: true, trustServerCertificate: true },
    });
  });

  it('reuses one pool across operations', async () => {
    const { pools, client } = fakeSqlClient();
    const provider = rotatingProvider('pw-1');
    const db = makeDb(provider, client);
    await db.run(async () => 1);
    await db.run(async () => 2);
    expect(pools).toHaveLength(1);
    expect(provider.getCredentials).toHaveBeenCalledTimes(1);
  });

  it('after a login failure, reloads credentials and retries once (password rotation)', async () => {
    const { pools, client } = fakeSqlClient();
    const provider = rotatingProvider('old-password', 'new-password');
    const db = makeDb(provider, client);
    await db.run(async () => 'warm up');

    let attempts = 0;
    const result = await db.run(async (pool) => {
      attempts += 1;
      if (pool.config.password === 'old-password') throw loginError();
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
    expect(provider.getCredentials).toHaveBeenCalledTimes(2);
    expect(pools[0].closed).toBe(true);
    expect(pools[1].config.password).toBe('new-password');
  });

  it('does not retry errors other than login failures', async () => {
    const { client } = fakeSqlClient();
    const provider = rotatingProvider('pw-1');
    const db = makeDb(provider, client);
    const operation = vi.fn(async () => {
      throw new Error('Invalid object name');
    });
    await expect(db.run(operation)).rejects.toThrow('Invalid object name');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries only once when the new credentials also fail', async () => {
    const { client } = fakeSqlClient();
    const db = makeDb(rotatingProvider('pw-1', 'pw-2'), client);
    const operation = vi.fn(async () => {
      throw loginError();
    });
    await expect(db.run(operation)).rejects.toMatchObject({ code: 'ELOGIN' });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not cache a pool that failed to connect', async () => {
    const { pools, client } = fakeSqlClient({ failConnectFor: ['bad'] });
    const provider = rotatingProvider('bad', 'bad', 'good');
    const db = makeDb(provider, client);
    await expect(db.run(async () => 'x')).rejects.toMatchObject({ code: 'ELOGIN' });
    await expect(db.run(async () => 'ok')).resolves.toBe('ok');
    expect(pools.at(-1).config.password).toBe('good');
  });

  it('close() releases the pool and is safe to call twice', async () => {
    const { pools, client } = fakeSqlClient();
    const db = makeDb(rotatingProvider('pw-1'), client);
    await db.run(async () => 'ok');
    await db.close();
    await db.close();
    expect(pools[0].closed).toBe(true);
  });
});

describe('isLoginFailure', () => {
  it.each([
    [{ code: 'ELOGIN' }, true],
    [{ number: 18456 }, true],
    [{ originalError: { number: 18456 } }, true],
    [{ code: 'ETIMEOUT' }, false],
    [new Error('other'), false],
    [undefined, false],
  ])('%o -> %s', (err, expected) => {
    expect(isLoginFailure(err)).toBe(expected);
  });
});
