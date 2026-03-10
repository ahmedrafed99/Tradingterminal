import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { withConnection, getAdapter } from '../middleware/withConnection';
import { OrderType, OrderSide } from '../types/enums';

const router = Router();

const BracketSchema = z.object({
  ticks: z.number().int(),
  type: z.number().int(),
});

const PlaceOrderSchema = z.object({
  accountId: z.number().int().positive(),
  contractId: z.string().min(1),
  type: z.nativeEnum(OrderType),
  side: z.nativeEnum(OrderSide),
  size: z.number().int().positive(), // TODO Phase 6: allow fractional quantities for crypto (remove .int())
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
router.post('/place', validateBody(PlaceOrderSchema), withConnection(async (req, res) => {
  const data = await getAdapter().orders.place(req.body);
  res.json(data);
}));

// POST /orders/cancel
router.post('/cancel', validateBody(CancelOrderSchema), withConnection(async (req, res) => {
  const data = await getAdapter().orders.cancel(req.body);
  res.json(data);
}));

// PATCH /orders/modify
router.patch('/modify', validateBody(ModifyOrderSchema), withConnection(async (req, res) => {
  const data = await getAdapter().orders.modify(req.body);
  res.json(data);
}));

// GET /orders/open?accountId=12345
router.get('/open', validateQuery(OpenOrdersQuery), withConnection(async (req, res) => {
  const accountId = Number(req.query['accountId']);
  const data = await getAdapter().orders.searchOpen(accountId);
  res.json(data);
}));

export default router;
