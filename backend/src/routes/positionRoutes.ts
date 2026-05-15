import { Router } from 'express';
import { z } from 'zod';
import { validateQuery, validateBody } from '../validate';
import { withConnection, resolveAdapter } from '../middleware/withConnection';

const router = Router();

const OpenPositionsQuery = z.object({
  accountId: z.string().min(1),
});

// GET /positions/open?accountId=12345
router.get('/open', validateQuery(OpenPositionsQuery), withConnection(async (req, res) => {
  const accountId = req.query['accountId'] as string;
  const data = await resolveAdapter(req).positions.searchOpen(accountId);
  res.json(data);
}));

const ClosePositionSchema = z.object({
  accountId: z.string().min(1),
  contractId: z.string().min(1),
});

// POST /positions/close
router.post('/close', validateBody(ClosePositionSchema), withConnection(async (req, res) => {
  const positions = resolveAdapter(req).positions;
  if (!positions.closePosition) {
    res.status(501).json({ success: false, errorMessage: 'closePosition not supported by this adapter' });
    return;
  }
  const data = await positions.closePosition(req.body);
  res.json(data);
}));

export default router;
