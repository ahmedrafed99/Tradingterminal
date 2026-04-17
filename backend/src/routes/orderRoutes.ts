import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { withConnection, resolveAdapter } from '../middleware/withConnection';
import { OrderType, OrderSide } from '../types/enums';
import { isBlacklisted } from '../services/blacklistService';

const router = Router();

// ProjectX brackets use tick offsets; Hyperliquid uses absolute prices
const BracketSchema = z.union([
  z.object({ ticks: z.number().int(), type: z.number().int() }),
  z.object({ price: z.number(), size: z.number().positive().optional() }),
]);

const PlaceOrderSchema = z.object({
  accountId: z.string().min(1),
  contractId: z.string().min(1),
  contractName: z.string().optional(),
  type: z.nativeEnum(OrderType),
  side: z.nativeEnum(OrderSide),
  size: z.number().positive(),
  limitPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  stopLossBracket: BracketSchema.optional(),
  takeProfitBrackets: z.array(BracketSchema).optional(),
});

const CancelOrderSchema = z.object({
  accountId: z.string().min(1),
  orderId: z.string().min(1),
});

const ModifyOrderSchema = z.object({
  accountId: z.string().min(1),
  orderId: z.string().min(1),
  size: z.number().positive().optional(),
  limitPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  trailPrice: z.number().optional(),
});

const OpenOrdersQuery = z.object({
  accountId: z.string().min(1),
});

// POST /orders/place
router.post('/place', validateBody(PlaceOrderSchema), withConnection(async (req, res) => {
  const { contractName, accountId } = req.body;
  if (contractName && await isBlacklisted(contractName, accountId)) {
    const root = contractName.replace(/[A-Z]\d+$/i, '').toUpperCase();
    res.status(403).json({ success: false, errorMessage: `${root} is blacklisted — orders are disabled on this symbol.` });
    return;
  }
  const data = await resolveAdapter(req).orders.place(req.body);
  res.json(data);
}));

// POST /orders/cancel
router.post('/cancel', validateBody(CancelOrderSchema), withConnection(async (req, res) => {
  const data = await resolveAdapter(req).orders.cancel(req.body);
  res.json(data);
}));

// PATCH /orders/modify
router.patch('/modify', validateBody(ModifyOrderSchema), withConnection(async (req, res) => {
  const data = await resolveAdapter(req).orders.modify(req.body);
  res.json(data);
}));

// GET /orders/open?accountId=12345
router.get('/open', validateQuery(OpenOrdersQuery), withConnection(async (req, res) => {
  const accountId = req.query['accountId'] as string;
  const data = await resolveAdapter(req).orders.searchOpen(accountId);
  res.json(data);
}));

export default router;
