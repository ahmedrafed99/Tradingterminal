/**
 * ProjectX realtime adapter — backend WebSocket client.
 *
 * Connects to the backend's /ws/realtime endpoint instead of ProjectX
 * SignalR directly. The backend holds the sole SignalR connection and
 * forwards all events here as simple JSON messages.
 *
 * Public API is identical to the previous SignalR-based adapter so all
 * consumers (chart, OrderPanel, TradesTab, PositionsTab, etc.) are unaffected.
 */

import type {
  RealtimeAdapter, Quote, DepthEntry,
  RealtimeOrder, RealtimePosition, RealtimeAccount, RealtimeTrade,
  QuoteHandler, DepthHandler, OrderHandler, PositionHandler,
  AccountHandler, TradeHandler, MarketTick, MarketTickHandler, HubStateHandler,
} from '../types';

// ---------------------------------------------------------------------------
// Message shapes from backend
// ---------------------------------------------------------------------------

interface BackendEvent {
  event: string;
  contractId?: string;
  action?: number;
  data?: unknown;
  hub?: string;
  state?: string;
  id?: unknown;
}

// ---------------------------------------------------------------------------
// Reconnect config
// ---------------------------------------------------------------------------

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ProjectXRealtimeAdapter implements RealtimeAdapter {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  // Handler lists
  private quoteHandlers:      QuoteHandler[]      = [];
  private depthHandlers:      DepthHandler[]      = [];
  private orderHandlers:      OrderHandler[]      = [];
  private positionHandlers:   PositionHandler[]   = [];
  private accountHandlers:    AccountHandler[]    = [];
  private tradeHandlers:      TradeHandler[]      = [];
  private marketTickHandlers: MarketTickHandler[] = [];
  private marketHubStateHandlers: HubStateHandler[] = [];
  private userHubStateHandlers:   HubStateHandler[] = [];
  private userReconnectHandlers:   (() => void)[] = [];
  private marketReconnectHandlers: (() => void)[] = [];

  // Subscription tracking (for re-subscribe on reconnect)
  private subscribedQuotes   = new Map<string, number>(); // refcount
  private subscribedDepth    = new Map<string, number>(); // refcount
  private subscribedAccounts = new Set<string>();
  private lastQuote          = new Map<string, Quote>();

  // Pending ping resolvers: id → resolve
  private pingResolvers = new Map<string, (ms: number) => void>();

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    return new Promise<void>((resolve) => {
      this.intentionalClose = false;
      this._open(resolve);
    });
  }

  private _open(onFirstConnect?: () => void): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    // Use relative path — Vite proxy maps /ws → backend:3001
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws/realtime`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Re-subscribe everything
      for (const contractId of this.subscribedQuotes.keys()) {
        this._send({ cmd: 'subscribeQuotes', contractId });
      }
      for (const contractId of this.subscribedDepth.keys()) {
        this._send({ cmd: 'subscribeDepth', contractId });
      }
      for (const accountId of this.subscribedAccounts) {
        this._send({ cmd: 'subscribeUser', accountId });
      }
      onFirstConnect?.();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as BackendEvent;
        this._dispatch(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.intentionalClose) return;

      this.marketHubStateHandlers.forEach((h) => h('reconnecting'));
      this.userHubStateHandlers.forEach((h) => h('reconnecting'));

      const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
      this.reconnectAttempt++;
      this.reconnectTimer = setTimeout(() => { this._open(); }, delay);
    };

    ws.onerror = () => { /* onclose fires after onerror */ };
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.subscribedQuotes.clear();
    this.subscribedDepth.clear();  // Map.clear() works unchanged
    this.subscribedAccounts.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Incoming event dispatch ─────────────────────────────────────────────────

  private _dispatch(msg: BackendEvent): void {
    switch (msg.event) {

      case 'GatewayQuote': {
        const contractId = msg.contractId ?? '';
        const data = msg.data as Quote;
        this.lastQuote.set(contractId, data);
        this.quoteHandlers.forEach((h) => h(contractId, data));
        break;
      }

      case 'GatewayTrade': {
        const contractId = msg.contractId ?? '';
        const arr = (Array.isArray(msg.data) ? msg.data : [msg.data]) as Array<{
          price?: number; Price?: number;
          size?: number; Size?: number; volume?: number; Volume?: number;
          timestamp?: string;
        }>;

        // Dispatch market ticks
        if (this.marketTickHandlers.length > 0) {
          const ticks: MarketTick[] = [];
          for (const t of arr) {
            const price = t.price ?? t.Price;
            const size  = t.size ?? t.Size ?? t.volume ?? t.Volume ?? 1;
            if (price && price > 0) {
              ticks.push({ price, size, timestampMs: t.timestamp ? new Date(t.timestamp).getTime() : Date.now() });
            }
          }
          if (ticks.length > 0) this.marketTickHandlers.forEach((h) => h(contractId, ticks));
        }

        // Synthesize quote from last trade price
        const last = arr[arr.length - 1];
        if (!last?.price && !last?.Price) break;
        const lastPrice = (last.price ?? last.Price)!;
        const prev = this.lastQuote.get(contractId);
        const synthetic: Quote = {
          symbol:        prev?.symbol        ?? '',
          symbolName:    prev?.symbolName    ?? '',
          lastPrice,
          bestBid:       prev?.bestBid       ?? lastPrice,
          bestAsk:       prev?.bestAsk       ?? lastPrice,
          change:        prev?.change        ?? 0,
          changePercent: prev?.changePercent ?? 0,
          open:          prev?.open          ?? lastPrice,
          high: Math.max(prev?.high ?? lastPrice, lastPrice),
          low:  Math.min(prev?.low  ?? lastPrice, lastPrice),
          volume: (prev?.volume ?? 0) + arr.length,
          lastUpdated: last.timestamp ?? new Date().toISOString(),
          timestamp:   last.timestamp ?? new Date().toISOString(),
        };
        this.lastQuote.set(contractId, synthetic);
        this.quoteHandlers.forEach((h) => h(contractId, synthetic));
        break;
      }

      case 'GatewayDepth': {
        const contractId = msg.contractId ?? '';
        const entries = (Array.isArray(msg.data) ? msg.data : []).filter(Boolean) as DepthEntry[];
        this.depthHandlers.forEach((h) => h(contractId, entries));
        break;
      }

      case 'GatewayUserOrder': {
        const order = msg.data as RealtimeOrder;
        const action = msg.action ?? 0;
        this.orderHandlers.forEach((h) => h(order, action));
        break;
      }

      case 'GatewayUserPosition': {
        const pos = msg.data as RealtimePosition;
        const action = msg.action ?? 0;
        this.positionHandlers.forEach((h) => h(pos, action));
        break;
      }

      case 'GatewayUserAccount': {
        const acct = msg.data as RealtimeAccount;
        const action = msg.action ?? 0;
        this.accountHandlers.forEach((h) => h(acct, action));
        break;
      }

      case 'GatewayUserTrade': {
        const trade = msg.data as RealtimeTrade;
        const action = msg.action ?? 0;
        this.tradeHandlers.forEach((h) => h(trade, action));
        break;
      }

      case 'hubState': {
        const state = (msg.state ?? 'disconnected') as 'connected' | 'reconnecting' | 'disconnected';
        if (msg.hub === 'market') {
          this.marketHubStateHandlers.forEach((h) => h(state));
          if (state === 'connected') this.marketReconnectHandlers.forEach((h) => h());
        } else if (msg.hub === 'user') {
          this.userHubStateHandlers.forEach((h) => h(state));
          if (state === 'connected') this.userReconnectHandlers.forEach((h) => h());
        }
        break;
      }

      case 'pong': {
        const id = String(msg.id ?? '');
        const resolver = this.pingResolvers.get(id);
        if (resolver) {
          this.pingResolvers.delete(id);
          resolver(Date.now());
        }
        break;
      }
    }
  }

  // ── Outgoing commands ───────────────────────────────────────────────────────

  private _send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ── Market hub subscriptions ────────────────────────────────────────────────

  subscribeQuotes(contractId: string): void {
    const prev = this.subscribedQuotes.get(contractId) ?? 0;
    this.subscribedQuotes.set(contractId, prev + 1);
    if (prev === 0) this._send({ cmd: 'subscribeQuotes', contractId });
  }

  unsubscribeQuotes(contractId: string): void {
    const prev = this.subscribedQuotes.get(contractId) ?? 0;
    if (prev <= 1) {
      this.subscribedQuotes.delete(contractId);
      this.lastQuote.delete(contractId);
      this._send({ cmd: 'unsubscribeQuotes', contractId });
    } else {
      this.subscribedQuotes.set(contractId, prev - 1);
    }
  }

  subscribeDepth(contractId: string): void {
    const prev = this.subscribedDepth.get(contractId) ?? 0;
    this.subscribedDepth.set(contractId, prev + 1);
    if (prev === 0) this._send({ cmd: 'subscribeDepth', contractId });
  }

  unsubscribeDepth(contractId: string): void {
    const prev = this.subscribedDepth.get(contractId) ?? 0;
    if (prev <= 1) {
      this.subscribedDepth.delete(contractId);
      this._send({ cmd: 'unsubscribeDepth', contractId });
    } else {
      this.subscribedDepth.set(contractId, prev - 1);
    }
  }

  // ── User hub subscriptions ──────────────────────────────────────────────────

  subscribeUserEvents(accountId: string): void {
    this.subscribedAccounts.add(accountId);
    this._send({ cmd: 'subscribeUser', accountId });
  }

  // ── Event handler registration ──────────────────────────────────────────────

  onQuote(h: QuoteHandler)           { this.quoteHandlers.push(h); }
  offQuote(h: QuoteHandler)          { this.quoteHandlers = this.quoteHandlers.filter((x) => x !== h); }
  onDepth(h: DepthHandler)           { this.depthHandlers.push(h); }
  offDepth(h: DepthHandler)          { this.depthHandlers = this.depthHandlers.filter((x) => x !== h); }
  onOrder(h: OrderHandler)           { this.orderHandlers.push(h); }
  offOrder(h: OrderHandler)          { this.orderHandlers = this.orderHandlers.filter((x) => x !== h); }
  onPosition(h: PositionHandler)     { this.positionHandlers.push(h); }
  offPosition(h: PositionHandler)    { this.positionHandlers = this.positionHandlers.filter((x) => x !== h); }
  onAccount(h: AccountHandler)       { this.accountHandlers.push(h); }
  offAccount(h: AccountHandler)      { this.accountHandlers = this.accountHandlers.filter((x) => x !== h); }
  onTrade(h: TradeHandler)           { this.tradeHandlers.push(h); }
  offTrade(h: TradeHandler)          { this.tradeHandlers = this.tradeHandlers.filter((x) => x !== h); }
  onMarketTick(h: MarketTickHandler) { this.marketTickHandlers.push(h); }
  offMarketTick(h: MarketTickHandler){ this.marketTickHandlers = this.marketTickHandlers.filter((x) => x !== h); }

  onUserReconnect(h: () => void)     { this.userReconnectHandlers.push(h); }
  offUserReconnect(h: () => void)    { this.userReconnectHandlers = this.userReconnectHandlers.filter((x) => x !== h); }
  onMarketReconnect(h: () => void)   { this.marketReconnectHandlers.push(h); }
  offMarketReconnect(h: () => void)  { this.marketReconnectHandlers = this.marketReconnectHandlers.filter((x) => x !== h); }

  onMarketHubState(h: HubStateHandler)  { this.marketHubStateHandlers.push(h); }
  offMarketHubState(h: HubStateHandler) { this.marketHubStateHandlers = this.marketHubStateHandlers.filter((x) => x !== h); }
  onUserHubState(h: HubStateHandler)    { this.userHubStateHandlers.push(h); }
  offUserHubState(h: HubStateHandler)   { this.userHubStateHandlers = this.userHubStateHandlers.filter((x) => x !== h); }

  // ── Latency ping ───────────────────────────────────────────────────────────

  async ping(): Promise<number> {
    if (!this.isConnected()) return -1;
    return this._doPing();
  }

  async pingUserHub(): Promise<number> {
    // Single connection — same measurement
    return this.ping();
  }

  private _doPing(): Promise<number> {
    return new Promise((resolve) => {
      const id  = String(Date.now());
      const start = Date.now();
      const timeout = setTimeout(() => {
        this.pingResolvers.delete(id);
        resolve(-1);
      }, 5000);

      this.pingResolvers.set(id, () => {
        clearTimeout(timeout);
        resolve(Date.now() - start);
      });

      this._send({ cmd: 'ping', id });
    });
  }
}

// ---------------------------------------------------------------------------
// Factory used by realtimeService.ts adapter registry
// ---------------------------------------------------------------------------

export function createProjectXRealtimeAdapter(): ProjectXRealtimeAdapter {
  return new ProjectXRealtimeAdapter();
}
