import { useEffect, useState } from 'react';
import { fetchGreeting, fetchHealth } from './api.js';
import './App.css';

const dbLabels = {
  checking: 'Checking database…',
  up: 'Database connected',
  down: 'Database unavailable',
  unknown: 'API unreachable',
};

export default function App() {
  const [greeting, setGreeting] = useState({ status: 'loading' });
  const [dbStatus, setDbStatus] = useState('checking');

  useEffect(() => {
    let active = true;
    fetchGreeting().then(
      (message) => active && setGreeting({ status: 'ready', message }),
      () => active && setGreeting({ status: 'error' }),
    );
    fetchHealth().then(
      (health) => active && setDbStatus(health.db),
      () => active && setDbStatus('unknown'),
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app">
      <section className="card" aria-live="polite">
        {greeting.status === 'loading' && <p className="muted">Loading…</p>}
        {greeting.status === 'ready' && <h1>{greeting.message}</h1>}
        {greeting.status === 'error' && (
          <p role="alert" className="error">
            Couldn’t load the greeting. Check that the API is running and see /api/health.
          </p>
        )}
        <p className="muted">React → Express → SQL Server</p>
        <p className={`status status-${dbStatus}`}>
          <span className="dot" aria-hidden="true" />
          {dbLabels[dbStatus] ?? dbLabels.unknown}
        </p>
      </section>
    </main>
  );
}
