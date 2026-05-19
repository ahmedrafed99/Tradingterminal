import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { withConnection, resolveAdapter } from '../middleware/withConnection';
import { OrderType, OrderSide } from '../types/enums';
import { isBlacklisted } from '../services/blacklistService';

function getContractCode(contractId: string): string {
  return contractId.split('.')[3] ?? '';
}

function areSiblings(posContractId: string, orderContractId: string, orderBaseSymbol: string): boolean {
  const posCode = getContractCode(posContractId);
  const orderCode = getContractCode(orderContractId);
  if (!posCode || !orderCode) return false;

  if (posCode === 'M' + orderCode || orderCode === 'M' + posCode) return true;

  if (posCode.startsWith('M') && !orderCode.startsWith('M')) {
    const suffix = posCode.slice(1);
    if (suffix.length >= 2 && orderBaseSymbol === suffix) return true;
  }

  if (orderBaseSymbol.startsWith('M') && !posCode.startsWith('M')) {
    const suffix = orderBaseSymbol.slice(1);
    if (suffix.length >= 2 && posCode.endsWith(suffix)) return true;
  }

  return false;
}

async function findHedgeConflict(
  adapter: ReturnType<typeof resolveAdapter>,
  orderContractId: string,
  orderBaseSymbol: string,
  orderSide: OrderSide,
  orderSize: number,
  orderAccountId: string,
): Promise<string | null> {
  try {
    const accountsRaw = await adapter.accounts.list() as { accounts?: { id: string | number; name: string }[] };
    const accounts = (accountsRaw.accounts ?? []).map((a) => ({ id: String(a.id), name: a.name }));
    if (accounts.length === 0) return null;

    const conflictingType = orderSide === OrderSide.Buy ? 2 : 1;

    const results = await Promise.allSettled(accounts.map((a) => adapter.positions.searchOpen(a.id)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue;
      const data = result.value as { positions?: unknown[]; data?: unknown[] };
      const positions = (data.positions ?? data.data ?? []) as { contractId?: unknown; type?: number; size?: number; accountId?: unknown }[];

      // If this order closes/reduces an existing position on the same account+contract,
      // no short is ever created — skip the entire hedge check for this account.
      const isClosingOwn = positions.some((p) => {
        const pId = String(p.contractId ?? '');
        const pAccountId = String(p.accountId ?? accounts[i].id);
        return pId === orderContractId && pAccountId === orderAccountId && p.type === conflictingType && (p.size ?? 0) >= orderSize;
      });
      if (isClosingOwn) return null;

      for (const pos of positions) {
        if (!pos.contractId || (pos.size ?? 0) <= 0 || pos.type !== conflictingType) continue;
        const posId = String(pos.contractId);
        const isSameContract = posId === orderContractId;
        const isSibling = !isSameContract && areSiblings(posId, orderContractId, orderBaseSymbol);

        if (!isSameContract && !isSibling) continue;

        return accounts[i].name;
      }
    }
  } catch (err) {
    console.error('[hedge-check] failed, allowing order through:', err instanceof Error ? err.message : err);
  }
  return null;
}

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
  const { contractName, accountId, contractId, side, size } = req.body;
  if (contractName && await isBlacklisted(contractName, accountId)) {
    const root = contractName.replace(/[A-Z]\d+$/i, '').toUpperCase();
    res.status(403).json({ success: false, errorMessage: `${root} is blacklisted — orders are disabled on this symbol.` });
    return;
  }

  const orderBaseSymbol = contractName ? contractName.replace(/[A-Z]\d+$/i, '') : getContractCode(contractId);
  const adapter = resolveAdapter(req);
  const conflictAccount = await findHedgeConflict(adapter, contractId, orderBaseSymbol, side, size, accountId);
  if (conflictAccount) {
    res.status(403).json({ success: false, errorMessage: `Hedging is not allowed — conflicting position already open on ${conflictAccount}.` });
    return;
  }

  const data = await adapter.orders.place(req.body);
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

const TrailToggleSchema = z.object({
  accountId: z.string().min(1),
  orderId: z.string().min(1),
  contractId: z.string().min(1),
  side: z.nativeEnum(OrderSide),
  size: z.number().positive(),
  stopPrice: z.number(),
  trailPrice: z.number().positive().optional(),
  targetType: z.union([z.literal(OrderType.Stop), z.literal(OrderType.TrailingStop)]),
});

// POST /orders/trail-toggle
// Converts a Stop ↔ TrailingStop: places the new order first, then cancels the old one.
// If placement fails the original order is untouched — position is never unprotected.
router.post('/trail-toggle', validateBody(TrailToggleSchema), withConnection(async (req, res) => {
  const adapter = resolveAdapter(req);
  const { accountId, orderId, contractId, side, size, stopPrice, trailPrice, targetType } = req.body;

  const data = await adapter.orders.place({
    accountId,
    contractId,
    type: targetType,
    side,
    size,
    stopPrice: targetType === OrderType.Stop ? stopPrice : undefined,
    trailPrice: targetType === OrderType.TrailingStop ? trailPrice : undefined,
  }) as { success: boolean; errorMessage?: string };

  if (!data.success) {
    throw new Error(data.errorMessage || 'Failed to place order');
  }

  await adapter.orders.cancel({ accountId, orderId });

  res.json(data);
}));

export default router;
