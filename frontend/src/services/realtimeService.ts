// ── Re-export canonical types (backward compat for consumers) ─────────────
export type {
  Quote,
  DepthEntry,
  RealtimeOrder,
  RealtimePosition,
  RealtimeAccount,
  RealtimeTrade,
  QuoteHandler,
  DepthHandler,
  OrderHandler,
  PositionHandler,
  AccountHandler,
  TradeHandler,
  MarketTick,
  MarketTickHandler,
  RealtimeAdapter,
} from '../adapters/types';

// Backward-compat alias
import type { Quote } from '../adapters/types';
export type GatewayQuote = Quote;

// ── Initialize default adapter ────────────────────────────────────────────
import type {
  QuoteHandler as QH, DepthHandler as DH, OrderHandler as OH,
  PositionHandler as PH, AccountHandler as AH, TradeHandler as TH,
  MarketTickHandler as MTH,
} from '../adapters/types';
import { setRealtimeAdapter, getRealtimeAdapter } from '../adapters/registry';
import { createProjectXRealtimeAdapter } from '../adapters/projectx';

setRealtimeAdapter(createProjectXRealtimeAdapter());

// ── Delegating facade ─────────────────────────────────────────────────────
// Consumers continue to import `realtimeService` — it proxies every call
// to whichever RealtimeAdapter is currently registered.

function adapter() { return getRealtimeAdapter(); }

export const realtimeService = {
  connect:             ()           => adapter().connect(),
  disconnect:          ()           => adapter().disconnect(),
  isConnected:         ()           => adapter().isConnected(),
  subscribeQuotes:     (id: string) => adapter().subscribeQuotes(id),
  unsubscribeQuotes:   (id: string) => adapter().unsubscribeQuotes(id),
  subscribeDepth:      (id: string) => adapter().subscribeDepth(id),
  unsubscribeDepth:    (id: string) => adapter().unsubscribeDepth(id),
  subscribeUserEvents: (id: string) => adapter().subscribeUserEvents(id),
  onQuote:             (h: QH)      => adapter().onQuote(h),
  offQuote:            (h: QH)      => adapter().offQuote(h),
  onDepth:             (h: DH)      => adapter().onDepth(h),
  offDepth:            (h: DH)      => adapter().offDepth(h),
  onOrder:             (h: OH)      => adapter().onOrder(h),
  offOrder:            (h: OH)      => adapter().offOrder(h),
  onPosition:          (h: PH)      => adapter().onPosition(h),
  offPosition:         (h: PH)      => adapter().offPosition(h),
  onAccount:           (h: AH)      => adapter().onAccount(h),
  offAccount:          (h: AH)      => adapter().offAccount(h),
  onTrade:             (h: TH)      => adapter().onTrade(h),
  offTrade:            (h: TH)      => adapter().offTrade(h),
  onMarketTick:        (h: MTH)     => adapter().onMarketTick(h),
  offMarketTick:       (h: MTH)     => adapter().offMarketTick(h),
  onUserReconnect:     (h: () => void) => adapter().onUserReconnect(h),
  offUserReconnect:    (h: () => void) => adapter().offUserReconnect(h),
  onMarketReconnect:   (h: () => void) => adapter().onMarketReconnect(h),
  offMarketReconnect:  (h: () => void) => adapter().offMarketReconnect(h),
  ping:                ()           => adapter().ping(),
};
