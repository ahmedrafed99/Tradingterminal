import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../validate';
import { withConnection, getAdapter } from '../middleware/withConnection';

const router = Router();

const OpenPositionsQuery = z.object({
  accountId: z.string().min(1),
});

// GET /positions/open?accountId=12345
router.get('/open', validateQuery(OpenPositionsQuery), withConnection(async (req, res) => {
  const accountId = req.query['accountId'] as string;
  const data = await getAdapter().positions.searchOpen(accountId);
  res.json(data);
}));

export default router;
