import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';

const config = { corsOrigin: 'http://localhost:5173' };
const logger = createLogger({ level: 'silent' });
const missingStaticDir = join(tmpdir(), 'hello-poc-no-frontend-build');

/** A stand-in for the database: every query is answered by `handler(queryText)`. */
function fakeDb(handler) {
  return {
    run: async (operation) =>
      operation({ request: () => ({ query: async (text) => handler(text) }) }),
  };
}

function makeApp(db, staticDir = missingStaticDir) {
  return createApp({ config, db, logger, staticDir });
}

describe('GET /api/greeting', () => {
  it('returns the greeting from the database', async () => {
    const app = makeApp(fakeDb(() => ({ recordset: [{ Message: 'Hello, World!' }] })));
    const res = await request(app).get('/api/greeting');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello, World!' });
  });

  it('returns 404 when no greeting exists', async () => {
    const app = makeApp(fakeDb(() => ({ recordset: [] })));
    const res = await request(app).get('/api/greeting');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No greeting found' });
  });

  it('returns a generic 500 without exposing error details', async () => {
    const app = makeApp(
      fakeDb(() => {
        throw new Error('Login failed for user poc_app at internal-host');
      }),
    );
    const res = await request(app).get('/api/greeting');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('poc_app');
  });
});

describe('GET /api/health', () => {
  it('reports the database as up', async () => {
    const app = makeApp(fakeDb(() => ({ recordset: [{ ok: 1 }] })));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('reports the database as down with 503', async () => {
    const app = makeApp(
      fakeDb(() => {
        throw new Error('connection refused');
      }),
    );
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'down' });
  });
});

describe('cross-cutting behaviour', () => {
  const app = makeApp(fakeDb(() => ({ recordset: [{ ok: 1 }] })));

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rate-limits each client and answers 429 with JSON', async () => {
    const limited = createApp({
      config: { ...config, rateLimitPerMinute: 2 },
      db: fakeDb(() => ({ recordset: [{ ok: 1 }] })),
      logger,
      staticDir: missingStaticDir,
    });
    expect((await request(limited).get('/api/health')).status).toBe(200);
    expect((await request(limited).get('/api/health')).status).toBe(200);
    const blocked = await request(limited).get('/api/health');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many requests' });
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('allows the configured frontend origin only', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('serving the React build', () => {
  const staticDir = mkdtempSync(join(tmpdir(), 'hello-poc-dist-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Hello POC</title>');
  const app = makeApp(
    fakeDb(() => ({ recordset: [] })),
    staticDir,
  );
  afterAll(() => rmSync(staticDir, { recursive: true, force: true }));

  it('serves index.html at the root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello POC');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await request(app).get('/some/page');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hello POC');
  });
});
