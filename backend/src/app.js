import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { describeError } from './logger.js';
import { greetingRouter } from './routes/greeting.js';
import { healthRouter } from './routes/health.js';

const defaultStaticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

/**
 * Builds the Express app. It takes its dependencies as arguments so tests can supply
 * a fake database instead of SQL Server.
 *
 * When the React build (frontend/dist) exists, the app also serves it, so production
 * runs as a single process on a single port.
 */
export function createApp({ config, db, logger, staticDir = defaultStaticDir }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  // Per-client-IP limit on every route (API, static files and the index.html fallback).
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute ?? 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    }),
  );
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use('/api/health', healthRouter(db, logger));
  app.use('/api/greeting', greetingRouter(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  // Express 5 forwards errors from async route handlers here.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    req.log.error({ err: describeError(err) }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
