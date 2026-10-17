import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

function jsonResponse(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** Stubs fetch with one handler per API path. */
function stubApi(routes) {
  vi.stubGlobal(
    'fetch',
    vi.fn((path) => routes[path]?.() ?? Promise.reject(new TypeError('Failed to fetch'))),
  );
}

describe('App', () => {
  it('shows a loading state first', () => {
    stubApi({
      '/api/greeting': () => new Promise(() => {}),
      '/api/health': () => new Promise(() => {}),
    });
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByText('Checking database…')).toBeInTheDocument();
  });

  it('shows the greeting from the API and a connected database', async () => {
    stubApi({
      '/api/greeting': () => jsonResponse(200, { message: 'Hello, World!' }),
      '/api/health': () => jsonResponse(200, { status: 'ok', db: 'up' }),
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Hello, World!' })).toBeInTheDocument();
    expect(await screen.findByText('Database connected')).toBeInTheDocument();
  });

  it('shows an error and the database status when the API fails', async () => {
    stubApi({
      '/api/greeting': () => jsonResponse(500, { error: 'Internal server error' }),
      '/api/health': () => jsonResponse(503, { status: 'degraded', db: 'down' }),
    });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the greeting');
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });

  it('reports an unreachable API', async () => {
    stubApi({});
    render(<App />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
