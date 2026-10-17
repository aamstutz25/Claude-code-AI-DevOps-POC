import { describe, expect, it } from 'vitest';
import { getConfig } from '../../src/config.js';

describe('getConfig', () => {
  it('uses secure, local defaults', () => {
    const config = getConfig({});
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toBe('http://localhost:5173');
    expect(config.db).toEqual({
      server: 'localhost',
      port: 1433,
      database: 'HelloPoc',
      encrypt: true,
      trustServerCertificate: false,
      credentialProvider: 'env',
    });
  });

  it('reads settings from the environment', () => {
    const config = getConfig({
      PORT: '4000',
      DB_SERVER: 'sql.example.internal',
      DB_PORT: '14330',
      DB_NAME: 'OtherDb',
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERTIFICATE: 'TRUE',
    });
    expect(config.port).toBe(4000);
    expect(config.db).toMatchObject({
      server: 'sql.example.internal',
      port: 14330,
      database: 'OtherDb',
      encrypt: false,
      trustServerCertificate: true,
    });
  });

  it('does not carry credentials', () => {
    const config = getConfig({ DB_USER: 'poc_app', DB_PASSWORD: 'secret' });
    expect(JSON.stringify(config)).not.toContain('secret');
  });

  it.each([
    [{ PORT: 'abc' }, 'PORT must be a port number'],
    [{ DB_PORT: '70000' }, 'DB_PORT must be a port number'],
    [
      { DB_TRUST_SERVER_CERTIFICATE: 'yes' },
      'DB_TRUST_SERVER_CERTIFICATE must be "true" or "false"',
    ],
  ])('rejects invalid values %o', (env, message) => {
    expect(() => getConfig(env)).toThrow(message);
  });
});
