import { Router } from 'express';
import { describeError } from '../logger.js';

/** Reports whether the API is running and can reach the database. */
export function healthRouter(db, logger) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      await db.run((pool) => pool.request().query('SELECT 1 AS ok'));
      res.json({ status: 'ok', db: 'up' });
    } catch (err) {
      logger.warn({ err: describeError(err) }, 'Health check: database unavailable');
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  return router;
}
