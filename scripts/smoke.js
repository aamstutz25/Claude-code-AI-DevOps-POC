// Production smoke test: starts the built app as it runs in production (one process
// serving the API and the React build) and checks it over HTTP.
//
// Usage (after `npm run build`):
//   node scripts/smoke.js --db=up     database configured: greeting is served
//   node scripts/smoke.js --db=down   no credentials: API still starts, reports 503,
//                                     and still serves the React app
//
// Uses SMOKE_PORT (default 3199) so it does not collide with a running dev server.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.find((arg) => arg.startsWith('--db='))?.slice(5);
if (mode !== 'up' && mode !== 'down') {
  console.error('Usage: node scripts/smoke.js --db=up|down');
  process.exit(2);
}

const port = process.env.SMOKE_PORT ?? '3199';
const baseUrl = `http://localhost:${port}`;
const env = { ...process.env, PORT: port };
if (mode === 'down') {
  // Point at a .env that does not exist and remove any credentials from the environment.
  env.ENV_FILE = join(repoRoot, '.env.smoke-test-does-not-exist');
  delete env.DB_USER;
  delete env.DB_PASSWORD;
}

const server = spawn(process.execPath, [join(repoRoot, 'backend/src/server.js')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

const checks = [];
function check(name, passed, detail = '') {
  checks.push({ name, passed, detail });
}

async function get(path) {
  const res = await fetch(baseUrl + path);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (for example the HTML page).
  }
  return { status: res.status, headers: res.headers, text, body };
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited with code ${server.exitCode}`);
    try {
      await fetch(`${baseUrl}/api/health`);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Server did not start on ${baseUrl} within ${timeoutMs / 1000}s`);
}

try {
  await waitForServer();

  const page = await get('/');
  check('GET / serves the React build', page.status === 200 && page.text.includes('id="root"'));
  check(
    'Security headers are set',
    page.headers.get('x-content-type-options') === 'nosniff' &&
      page.headers.has('content-security-policy') &&
      !page.headers.has('x-powered-by'),
  );

  const health = await get('/api/health');
  const greeting = await get('/api/greeting');
  if (mode === 'up') {
    check(
      'GET /api/health reports the database up',
      health.status === 200 && health.body?.db === 'up',
      `got ${health.status} ${health.text}`,
    );
    check(
      'GET /api/greeting returns Hello, World!',
      greeting.status === 200 && greeting.body?.message === 'Hello, World!',
      `got ${greeting.status} ${greeting.text}`,
    );
  } else {
    check(
      'GET /api/health reports the database down with 503',
      health.status === 503 && health.body?.db === 'down',
      `got ${health.status} ${health.text}`,
    );
    check(
      'GET /api/greeting fails without internal details',
      greeting.status === 500 && greeting.body?.error === 'Internal server error',
      `got ${greeting.status} ${greeting.text}`,
    );
  }
  check('Unknown API routes return JSON 404', (await get('/api/nope')).status === 404);
} catch (err) {
  check('Server started and responded', false, err.message);
} finally {
  server.kill();
}

for (const { name, passed, detail } of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${passed || !detail ? '' : `  (${detail})`}`);
}
if (checks.some((c) => !c.passed)) {
  console.log('\n--- server output ---\n' + serverOutput);
  process.exitCode = 1;
} else {
  console.log(`\nSmoke test passed (database ${mode}).`);
}
