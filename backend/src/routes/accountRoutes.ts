import { Router } from 'express';
import { withConnection, getAdapter } from '../middleware/withConnection';

const router = Router();

// GET /accounts
router.get('/', withConnection(async (_req, res) => {
  const data = await getAdapter().accounts.list();
  res.json(data);
}));

export default router;
