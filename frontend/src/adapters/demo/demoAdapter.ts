/**
 * DemoRealtimeAdapter — a fully in-memory adapter that drives the app with
 * synthetic NQ data. No backend connection required.
 *
 * Activate via ?demo=true in the URL (bootstrapped in main.tsx).
 */

import type {
  RealtimeAdapter,
  RealtimeOrder,
  QuoteHandler,
  DepthHandler,
  OrderHandler,
  PositionHandler,
  AccountHandler,
  TradeHandler,
  MarketTickHandler,
  HubStateHandler,
  Quote,
} from '../types';
import { OrderType, OrderSide, OrderStatus, PositionType } from '../../types/enums';

export const DEMO_CONTRACT_ID = 'demo-nq-contract';
export const DEMO_ACCOUNT_ID  = 'demo-account-1';

const ENTRY_PRICE = 21_480;
const SL_PRICE    = 21_440;
const TP_PRICE    = 21_560;
const POS_SIZE    = 2;

// Shared mutable price — seeded from the last historical bar by bootstrapDemoMode()
export let demoPrice = 21_543.25;
export function setDemoPrice(p: number) { demoPrice = p; }
const SESSION_OPEN   = 21_500;

function tick(pull = 0): number {
  const delta = pull + (Math.random() - 0.5) * 2.5 + (Math.random() - 0.5) * 0.5;
  demoPrice   = Math.round((demoPrice + delta) * 4) / 4; // 0.25-pt tick
  return demoPrice;
}

// ---------------------------------------------------------------------------
//  Handler registry helper
// ---------------------------------------------------------------------------
class HandlerSet<T extends (...args: never[]) => void> {
  private set = new Set<T>();
  add(h: T)     { this.set.add(h); }
  remove(h: T)  { this.set.delete(h); }
  fire(...args: Parameters<T>) { this.set.forEach((h) => (h as unknown as (...a: Parameters<T>) => void)(...args)); }
}

// ---------------------------------------------------------------------------
//  Adapter
// ---------------------------------------------------------------------------
export class DemoRealtimeAdapter implements RealtimeAdapter {
  private connected_       = false;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private userEventsSeeded = false;
  private sessionVolume    = 125_000;
  private orderRegistry    = new Map<string, RealtimeOrder>();

  private quoteH    = new HandlerSet<QuoteHandler>();
  private depthH    = new HandlerSet<DepthHandler>();
  private orderH    = new HandlerSet<OrderHandler>();
  private posH      = new HandlerSet<PositionHandler>();
  private acctH     = new HandlerSet<AccountHandler>();
  private tradeH    = new HandlerSet<TradeHandler>();
  private mTickH    = new HandlerSet<MarketTickHandler>();
  private uReconH   = new HandlerSet<() => void>();
  private mReconH   = new HandlerSet<() => void>();
  private mHubH     = new HandlerSet<HubStateHandler>();
  private uHubH     = new HandlerSet<HubStateHandler>();

  // ── Connection ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.connected_ = true;
    // Signal hubs are "connected" immediately
    setTimeout(() => {
      this.mHubH.fire('connected');
      this.uHubH.fire('connected');
    }, 50);
  }

  async disconnect(): Promise<void> {
    this.connected_ = false;
    this._stopTicking();
  }

  isConnected(): boolean { return this.connected_; }

  // ── Market subscriptions ──────────────────────────────────────────────────

  subscribeQuotes(contractId: string): void {
    if (contractId !== DEMO_CONTRACT_ID) return;
    this._startTicking();
  }

  unsubscribeQuotes(contractId: string): void {
    if (contractId === DEMO_CONTRACT_ID) this._stopTicking();
  }

  subscribeDepth(_contractId: string): void { /* no-op */ }
  unsubscribeDepth(_contractId: string): void { /* no-op */ }

  // ── User subscriptions ────────────────────────────────────────────────────

  subscribeUserEvents(_accountId: string): void {
    // Guard: only seed once — re-subscribing (reconnect, account switch) must
    // not duplicate the position + orders in the store.
    if (this.userEventsSeeded) return;
    this.userEventsSeeded = true;

    // Emit the fake long position + bracket orders after a short delay
    // (gives the store time to set up handlers)
    setTimeout(() => {
      // Long position
      this.posH.fire(
        {
          id: 'demo-pos-1',
          accountId: DEMO_ACCOUNT_ID,
          contractId: DEMO_CONTRACT_ID,
          type: PositionType.Long,
          size: POS_SIZE,
          averagePrice: ENTRY_PRICE,
        },
        0, // action 0 = new/update
      );

      // Stop Loss bracket leg
      this.emitOrder(
        {
          id: 'demo-sl',
          accountId: DEMO_ACCOUNT_ID,
          contractId: DEMO_CONTRACT_ID,
          status: OrderStatus.Working,
          type: OrderType.Stop,
          side: OrderSide.Sell,
          size: POS_SIZE,
          stopPrice: SL_PRICE,
          customTag: 'demo-parent-SL',
        },
        0,
      );

      // Take Profit bracket leg
      this.emitOrder(
        {
          id: 'demo-tp1',
          accountId: DEMO_ACCOUNT_ID,
          contractId: DEMO_CONTRACT_ID,
          status: OrderStatus.Working,
          type: OrderType.Limit,
          side: OrderSide.Sell,
          size: POS_SIZE,
          limitPrice: TP_PRICE,
          customTag: 'demo-parent-TP1',
        },
        0,
      );
    }, 400);
  }

  // ── Price ticker ──────────────────────────────────────────────────────────

  private _startTicking(): void {
    if (this.tickInterval) return;

    let sessionHigh = Math.max(demoPrice, SESSION_OPEN);
    let sessionLow  = Math.min(demoPrice, SESSION_OPEN);

    this.tickInterval = setInterval(() => {
      // Soft mean-reversion pull toward entry keeps price near SL/TP
      const pull = (ENTRY_PRICE - demoPrice) * 0.003;
      const p    = tick(pull);
      sessionHigh = Math.max(sessionHigh, p);
      sessionLow  = Math.min(sessionLow,  p);
      // Volume accumulates through the session instead of oscillating
      this.sessionVolume += Math.floor(Math.random() * 30) + 5;
      const now = new Date().toISOString();

      const quote: Quote = {
        symbol:        'NQZ5',
        symbolName:    'NASDAQ-100 E-MINI',
        lastPrice:     p,
        bestBid:       p - 0.25,
        bestAsk:       p + 0.25,
        change:        p - SESSION_OPEN,
        changePercent: (p - SESSION_OPEN) / SESSION_OPEN * 100,
        open:          SESSION_OPEN,
        high:          sessionHigh,
        low:           sessionLow,
        volume:        this.sessionVolume,
        lastUpdated:   now,
        timestamp:     now,
      };

      this.quoteH.fire(DEMO_CONTRACT_ID, quote);

      this.mTickH.fire(DEMO_CONTRACT_ID, [
        {
          price:       p,
          size:        Math.floor(Math.random() * 6) + 1,
          timestampMs: Date.now(),
        },
      ]);
    }, 280);
  }

  private _stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // ── Public emit helpers (used by demoAxiosAdapter for interactive ops) ───

  /** Emit an order event and keep the registry in sync. */
  emitOrder(order: RealtimeOrder, action: number): void {
    if (action === 0) {
      this.orderRegistry.set(order.id, order);
    } else {
      this.orderRegistry.delete(order.id);
    }
    this.orderH.fire(order, action);
  }

  /** Look up a tracked order and re-emit it as Cancelled. */
  emitCancelOrder(orderId: string): void {
    const existing = this.orderRegistry.get(orderId);
    if (!existing) return;
    const cancelled = { ...existing, status: OrderStatus.Cancelled };
    this.orderRegistry.delete(orderId);
    this.orderH.fire(cancelled, 1);
  }

  /** Apply price/size updates to a tracked order and re-emit it. */
  emitModifyOrder(orderId: string, updates: Partial<RealtimeOrder>): void {
    const existing = this.orderRegistry.get(orderId);
    if (!existing) return;
    const updated = { ...existing, ...updates, id: orderId };
    this.orderRegistry.set(orderId, updated);
    this.orderH.fire(updated, 0);
  }

  // ── Handler registration ──────────────────────────────────────────────────

  onQuote(h: QuoteHandler)              { this.quoteH.add(h); }
  offQuote(h: QuoteHandler)             { this.quoteH.remove(h); }
  onDepth(h: DepthHandler)              { this.depthH.add(h); }
  offDepth(h: DepthHandler)             { this.depthH.remove(h); }
  onOrder(h: OrderHandler)              { this.orderH.add(h); }
  offOrder(h: OrderHandler)             { this.orderH.remove(h); }
  onPosition(h: PositionHandler)        { this.posH.add(h); }
  offPosition(h: PositionHandler)       { this.posH.remove(h); }
  onAccount(h: AccountHandler)          { this.acctH.add(h); }
  offAccount(h: AccountHandler)         { this.acctH.remove(h); }
  onTrade(h: TradeHandler)              { this.tradeH.add(h); }
  offTrade(h: TradeHandler)             { this.tradeH.remove(h); }
  onMarketTick(h: MarketTickHandler)    { this.mTickH.add(h); }
  offMarketTick(h: MarketTickHandler)   { this.mTickH.remove(h); }
  onUserReconnect(h: () => void)        { this.uReconH.add(h); }
  offUserReconnect(h: () => void)       { this.uReconH.remove(h); }
  onMarketReconnect(h: () => void)      { this.mReconH.add(h); }
  offMarketReconnect(h: () => void)     { this.mReconH.remove(h); }
  onMarketHubState(h: HubStateHandler)  { this.mHubH.add(h); }
  offMarketHubState(h: HubStateHandler) { this.mHubH.remove(h); }
  onUserHubState(h: HubStateHandler)    { this.uHubH.add(h); }
  offUserHubState(h: HubStateHandler)   { this.uHubH.remove(h); }

  async ping(): Promise<number>         { return 1; }
  async pingUserHub(): Promise<number>  { return 1; }
}
