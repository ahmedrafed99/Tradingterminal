import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { getBaseUrl, authHeaders, isConnected } from '../auth';
import { validateBody, validateQuery } from '../validate';

const router = Router();

const BracketSchema = z.object({
  ticks: z.number().int(),
  type: z.number().int(),
});

const PlaceOrderSchema = z.object({
  accountId: z.number().int().positive(),
  contractId: z.string().min(1),
  type: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(5)]),
  side: z.union([z.literal(0), z.literal(1)]),
  size: z.number().int().positive(),
  limitPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  stopLossBracket: BracketSchema.optional(),
  takeProfitBracket: BracketSchema.optional(),
});

const CancelOrderSchema = z.object({
  accountId: z.number().int().positive(),
  orderId: z.number().int().positive(),
});

const ModifyOrderSchema = z.object({
  accountId: z.number().int().positive(),
  orderId: z.number().int().positive(),
  size: z.number().int().positive().optional(),
  limitPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  trailPrice: z.number().optional(),
});

const OpenOrdersQuery = z.object({
  accountId: z.string().regex(/^\d+$/, 'accountId must be a number'),
});

// POST /orders/place
router.post('/place', validateBody(PlaceOrderSchema), async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/place`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// POST /orders/cancel
router.post('/cancel', validateBody(CancelOrderSchema), async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/cancel`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// PATCH /orders/modify
router.patch('/modify', validateBody(ModifyOrderSchema), async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/modify`,
      req.body,
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

// GET /orders/open?accountId=12345
router.get('/open', validateQuery(OpenOrdersQuery), async (req, res) => {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }

  const accountId = Number(req.query['accountId']);

  try {
    const response = await axios.post(
      `${getBaseUrl()}/api/Order/searchOpen`,
      { accountId },
      { headers: authHeaders() },
    );
    res.json(response.data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ success: false, errorMessage: msg });
  }
});

export default router;
