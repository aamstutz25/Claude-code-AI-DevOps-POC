import { Router } from 'express';

export function greetingRouter(db) {
  const router = Router();

  router.get('/', async (req, res) => {
    const result = await db.run((pool) =>
      pool.request().query('SELECT TOP (1) Message FROM dbo.Greeting ORDER BY GreetingId'),
    );
    const row = result.recordset[0];
    if (!row) {
      res.status(404).json({ error: 'No greeting found' });
      return;
    }
    res.json({ message: row.Message });
  });

  return router;
}
