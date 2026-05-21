/**
 * bootstrapDemoMode()
 *
 * Call this ONCE before React renders (in main.tsx) when ?demo=true.
 * It does two things:
 *   1. Replaces the axios adapter so every REST call returns mock data.
 *   2. Installs DemoRealtimeAdapter so SignalR never touches the network.
 */

import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import api from '../../services/api';
import type { Bar } from '../../services/marketDataService';
import type { RealtimePosition, RealtimeOrder } from '../types';
import type { Order } from '../../services/orderService';
import { OrderType, OrderSide, OrderStatus, PositionType } from '../../types/enums';
import { DemoRealtimeAdapter, DEMO_CONTRACT_ID, DEMO_ACCOUNT_ID, setDemoPrice, setDemoBracketPrices } from './demoAdapter';
import { setRealtimeAdapter } from '../registry';

// Shared adapter reference — lets the axios mock fire realtime events for
// interactive ops (place / cancel / modify) so the UI stays consistent.
let _demoAdapter: DemoRealtimeAdapter | null = null;

// ─── Demo contract ────────────────────────────────────────────────────────────
const DEMO_CONTRACT = {
  id:                  DEMO_CONTRACT_ID,
  name:                'NQZ5',
  description:         'NASDAQ-100 E-MINI DEC25',
  tickSize:            0.25,
  tickValue:           5,
  activeContract:      true,
  marketType:          'crypto' as const,  // bypasses CME hours check so candles always update
  ticksPerPoint:       4,
  quantityStep:        1,
  pricePrecision:      2,
  quantityPrecision:   0,
};

// ─── Demo account ─────────────────────────────────────────────────────────────
const DEMO_ACCOUNT = {
  id:        DEMO_ACCOUNT_ID,
  name:      'Demo — Apex PA',
  balance:   150_000,
  canTrade:  true,
  isVisible: true,
};

// ─── Demo positions (REST snapshot) ──────────────────────────────────────────
const DEMO_POSITIONS: RealtimePosition[] = [
  {
    id:           'demo-pos-1',
    accountId:    DEMO_ACCOUNT_ID,
    contractId:   DEMO_CONTRACT_ID,
    type:         PositionType.Long,
    size:         2,
    averagePrice: 21_480,
  },
];

// ─── Demo open orders (REST snapshot) ────────────────────────────────────────
const DEMO_OPEN_ORDERS: Order[] = [
  {
    id:         'demo-sl',
    contractId: DEMO_CONTRACT_ID,
    type:       OrderType.Stop,
    side:       OrderSide.Sell,
    size:       2,
    stopPrice:  21_440,
    status:     OrderStatus.Working,
    customTag:  'demo-parent-SL',
  },
  {
    id:         'demo-tp1',
    contractId: DEMO_CONTRACT_ID,
    type:       OrderType.Limit,
    side:       OrderSide.Sell,
    size:       2,
    limitPrice: 21_560,
    status:     OrderStatus.Working,
    customTag:  'demo-parent-TP1',
  },
];

// ─── Demo trades (session history) ───────────────────────────────────────────
const now = Date.now();
const DEMO_TRADES = [
  {
    id: 'dt-1', accountId: DEMO_ACCOUNT_ID, contractId: DEMO_CONTRACT_ID,
    price: 21_440, profitAndLoss: 2400, fees: 4.16, commissions: 0,
    side: OrderSide.Sell, size: 2, voided: false, orderId: 'do-1',
    creationTimestamp: new Date(now - 95 * 60_000).toISOString(),
  },
  {
    id: 'dt-2', accountId: DEMO_ACCOUNT_ID, contractId: DEMO_CONTRACT_ID,
    price: 21_490, profitAndLoss: 600, fees: 2.08, commissions: 0,
    side: OrderSide.Buy,  size: 1, voided: false, orderId: 'do-2',
    creationTimestamp: new Date(now - 75 * 60_000).toISOString(),
  },
  {
    id: 'dt-3', accountId: DEMO_ACCOUNT_ID, contractId: DEMO_CONTRACT_ID,
    price: 21_430, profitAndLoss: -1200, fees: 4.16, commissions: 0,
    side: OrderSide.Sell, size: 2, voided: false, orderId: 'do-3',
    creationTimestamp: new Date(now - 45 * 60_000).toISOString(),
  },
];

// ─── Historical bar generator ─────────────────────────────────────────────────
// Cached per period — keyed by periodMs so 1m, 5m, 15m etc. each get their own
// set of bars with correctly-aligned timestamps.
// Date.now() is called inside the function (not at module load) so the last
// bar's timestamp is always the current in-progress period — no gap at the
// right edge even if the page was open for a while before the chart mounts.
const _barsCache = new Map<number, Bar[]>();

// Convert BarUnit (1=Sec 2=Min 3=Hr 4=Day 5=Wk 6=Mo) + unitNumber → ms
function periodMsFrom(unit: number, unitNumber: number): number {
  const unitMs: Record<number, number> = {
    1: 1_000, 2: 60_000, 3: 3_600_000, 4: 86_400_000,
    5: 7 * 86_400_000, 6: 30 * 86_400_000,
  };
  return (unitMs[unit] ?? 60_000) * unitNumber;
}

function generateBars(count = 500, periodMs = 60_000): Bar[] {
  if (_barsCache.has(periodMs)) return _barsCache.get(periodMs)!;
  let p = 21_350;
  const bars: Bar[] = [];
  // Fresh Date.now() so the last bar is always the current in-progress period.
  const base = Math.floor(Date.now() / periodMs) * periodMs;
  for (let i = count; i >= 0; i--) {
    const t   = new Date(base - i * periodMs).toISOString();
    const o   = p;
    const mv  = (Math.random() - 0.47) * 14 + (Math.random() - 0.5) * 4;
    const c   = Math.round((o + mv) * 4) / 4;
    const rng = Math.abs(mv) * 0.6 + Math.random() * 7 + 2;
    const h   = Math.round((Math.max(o, c) + Math.random() * rng) * 4) / 4;
    const l   = Math.round((Math.min(o, c) - Math.random() * rng) * 4) / 4;
    const v   = Math.floor(Math.random() * 800 + 100);
    bars.push({ t, o, h, l, c, v });
    p = c;
  }
  _barsCache.set(periodMs, bars);
  return bars;
}

// ─── Axios mock adapter ───────────────────────────────────────────────────────
function mockResp(data: unknown, config: InternalAxiosRequestConfig) {
  return Promise.resolve({
    data,
    status:     200,
    statusText: 'OK',
    headers:    {},
    config,
    request:    {},
  });
}

const demoAxiosAdapter: AxiosAdapter = (config) => {
  const url    = config.url ?? '';
  const method = (config.method ?? 'get').toLowerCase();

  // Auth
  if (url.includes('/auth/status')) {
    return mockResp({ connected: true, baseUrl: 'https://demo.tradeterminal.io' }, config);
  }

  // Accounts
  if (url.includes('/accounts/eligibility')) {
    return mockResp([], config);
  }
  if (url.endsWith('/accounts') || url.includes('/accounts?')) {
    return mockResp({ accounts: [DEMO_ACCOUNT], success: true }, config);
  }

  // Positions
  if (url.includes('/positions/open')) {
    return mockResp({ positions: DEMO_POSITIONS, success: true }, config);
  }

  // Orders
  if (url.includes('/orders/open')) {
    return mockResp({ orders: DEMO_OPEN_ORDERS, success: true }, config);
  }

  // Trades
  if (url.includes('/trades')) {
    return mockResp({ trades: DEMO_TRADES, success: true }, config);
  }

  // Market data
  if (url.includes('/market/contracts/search')) {
    return mockResp({ contracts: [DEMO_CONTRACT], success: true }, config);
  }
  if (url.includes('/market/contracts/available')) {
    return mockResp({ contracts: [DEMO_CONTRACT], success: true }, config);
  }
  if (url.includes('/market/bars') && method === 'post') {
    const body: { unit?: number; unitNumber?: number } = config.data
      ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data)
      : {};
    const periodMs = periodMsFrom(body.unit ?? 2, body.unitNumber ?? 1);
    return mockResp({ bars: generateBars(500, periodMs), success: true }, config);
  }

  // Settings (read/write — return empty so useSettingsSync doesn't crash)
  if (url.includes('/settings')) {
    return mockResp({ settings: {}, success: true }, config);
  }

  // Drawings
  if (url.includes('/drawings')) {
    return mockResp({ drawings: [], success: true }, config);
  }

  // ── Order mutations — fire realtime confirmation so the UI stays consistent ──

  // Place order: emit a Working order back through the realtime adapter
  if (url.includes('/orders/place')) {
    const body: Partial<RealtimeOrder> = config.data
      ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data)
      : {};
    const id = `demo-order-${Date.now()}`;
    const order: RealtimeOrder = {
      id,
      accountId:  String(body.accountId  ?? DEMO_ACCOUNT_ID),
      contractId: String(body.contractId ?? DEMO_CONTRACT_ID),
      status:     OrderStatus.Working,
      type:       body.type   ?? OrderType.Limit,
      side:       body.side   ?? OrderSide.Buy,
      size:       body.size   ?? 1,
      limitPrice: body.limitPrice,
      stopPrice:  body.stopPrice,
      customTag:  body.customTag,
    };
    setTimeout(() => _demoAdapter?.emitOrder(order, 0), 100);
    return mockResp({ orderId: id, success: true }, config);
  }

  // Cancel order: emit Cancelled status back through the realtime adapter
  if (url.includes('/orders/cancel')) {
    const body: { orderId?: string | number } = config.data
      ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data)
      : {};
    const orderId = String(body.orderId ?? '');
    setTimeout(() => _demoAdapter?.emitCancelOrder(orderId), 100);
    return mockResp({ success: true }, config);
  }

  // Modify order: re-emit the order with updated prices
  if (url.includes('/orders/modify')) {
    const body: Partial<RealtimeOrder> & { orderId?: string | number } = config.data
      ? (typeof config.data === 'string' ? JSON.parse(config.data) : config.data)
      : {};
    const orderId = String(body.orderId ?? '');
    setTimeout(() => _demoAdapter?.emitModifyOrder(orderId, {
      limitPrice: body.limitPrice,
      stopPrice:  body.stopPrice,
      size:       body.size,
    }), 100);
    return mockResp({ success: true }, config);
  }

  // Catch-all: silently succeed
  return mockResp({ success: true }, config);
};

// ─── Demo flag ────────────────────────────────────────────────────────────────
/**
 * True once bootstrapDemoMode() has been called.
 * Import this anywhere that opens raw browser connections (WebSocket, EventSource,
 * fetch) that bypass the axios mock — guard those with `if (IS_DEMO) return`.
 */
export let IS_DEMO = false;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Round to nearest 0.25-pt tick
function roundTick(p: number): number { return Math.round(p * 4) / 4; }

export function bootstrapDemoMode(): void {
  IS_DEMO = true;
  // Seed the live price from the last historical bar so the current candle
  // continues exactly where history ended — no gap at the right edge.
  const seedBars  = generateBars();
  const lastPrice = seedBars[seedBars.length - 1].c;
  setDemoPrice(lastPrice);

  // Compute bracket prices relative to the live seed price so everything
  // appears around the current candle — not at arbitrary hardcoded levels.
  const entry = roundTick(lastPrice - 20);   // entry 20 pts below → small open loss on long
  const sl    = roundTick(entry - 40);       // SL 40 pts below entry
  const tp    = roundTick(entry + 80);       // TP 80 pts above entry

  setDemoBracketPrices(entry, sl, tp);

  // Patch the REST snapshot objects so the initial HTTP calls also return
  // the same relative prices (realtime emits above stay in sync via the consts).
  DEMO_POSITIONS[0].averagePrice   = entry;
  DEMO_OPEN_ORDERS[0].stopPrice    = sl;
  DEMO_OPEN_ORDERS[1].limitPrice   = tp;

  // 1. Replace axios adapter — all REST calls now return mock data
  api.defaults.adapter = demoAxiosAdapter;

  // 2. Replace realtime adapter — no WebSocket / SignalR connections.
  //    Keep a reference so the axios mock can fire realtime confirmations
  //    for order placement / cancel / modify.
  _demoAdapter = new DemoRealtimeAdapter();
  setRealtimeAdapter(_demoAdapter);
}
