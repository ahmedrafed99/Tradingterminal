import { Router } from 'express';
import { withConnection, resolveAdapter } from '../middleware/withConnection';

const router = Router();

// GET /accounts?exchange=hyperliquid  (exchange param optional, defaults to active)
router.get('/', withConnection(async (req, res) => {
  const data = await resolveAdapter(req).accounts.list();
  res.json(data);
}));

export default router;
