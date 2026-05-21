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
import { DemoRealtimeAdapter, DEMO_CONTRACT_ID, DEMO_ACCOUNT_ID, setDemoPrice } from './demoAdapter';
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
// Cached — called twice (bootstrap seed + axios mock) but must return the same
// bars both times so the seeded live price matches what the chart loads.
let _cachedBars: Bar[] | null = null;

function generateBars(count = 500): Bar[] {
  if (_cachedBars) return _cachedBars;
  let p = 21_350;
  const bars: Bar[] = [];
  const PERIOD_MS = 5 * 60_000;
  // Floor 'now' to the current 5-min boundary so the last bar's timestamp
  // matches what floorToCandlePeriod() produces from a live quote — otherwise
  // lastBar.time > candleTime and every tick is silently dropped by useChartBars.
  const base = Math.floor(now / PERIOD_MS) * PERIOD_MS;
  for (let i = count; i >= 0; i--) {
    const t   = new Date(base - i * PERIOD_MS).toISOString();
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
  _cachedBars = bars;
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
    return mockResp({ bars: generateBars(), success: true }, config);
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

// ─── Bootstrap ────────────────────────────────────────────────────────────────
export function bootstrapDemoMode(): void {
  // Seed the live price from the last historical bar so the current candle
  // continues exactly where history ended — no gap at the right edge.
  const seedBars = generateBars();
  setDemoPrice(seedBars[seedBars.length - 1].c);

  // 1. Replace axios adapter — all REST calls now return mock data
  api.defaults.adapter = demoAxiosAdapter;

  // 2. Replace realtime adapter — no WebSocket / SignalR connections.
  //    Keep a reference so the axios mock can fire realtime confirmations
  //    for order placement / cancel / modify.
  _demoAdapter = new DemoRealtimeAdapter();
  setRealtimeAdapter(_demoAdapter);
}
