async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

/** Returns the greeting text, or throws if the API cannot provide one. */
export async function fetchGreeting() {
  const { ok, body } = await getJson('/api/greeting');
  if (!ok || typeof body?.message !== 'string') {
    throw new Error('Greeting unavailable');
  }
  return body.message;
}

/** Returns the API health report ({ status, db }); 503 responses still carry a report. */
export async function fetchHealth() {
  const { body } = await getJson('/api/health');
  if (!body?.db) {
    throw new Error('Health report unavailable');
  }
  return body;
}
