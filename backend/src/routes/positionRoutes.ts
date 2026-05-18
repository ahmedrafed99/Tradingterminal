import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
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

const ClosePositionBody = z.object({
  exchange: z.string().optional(),
  accountId: z.string().min(1),
  contractId: z.string().min(1),
});

// POST /positions/close
router.post('/close', validateBody(ClosePositionBody), withConnection(async (req, res) => {
  const { accountId, contractId } = req.body as { accountId: string; contractId: string };
  const positions = resolveAdapter(req).positions;
  if (!positions.closeContract) {
    res.status(501).json({ success: false, errorMessage: 'closeContract not supported by this exchange' });
    return;
  }
  const data = await positions.closeContract({ accountId, contractId });
  res.json(data);
}));

export default router;
