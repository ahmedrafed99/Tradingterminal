import * as signalR from '@microsoft/signalr';
import { HttpTransportType } from '@microsoft/signalr';
import type {
  RealtimeAdapter, Quote, DepthEntry,
  RealtimeOrder, RealtimePosition, RealtimeAccount, RealtimeTrade,
  QuoteHandler, DepthHandler, OrderHandler, PositionHandler,
  AccountHandler, TradeHandler, MarketTick, MarketTickHandler,
} from '../types';

// ── SignalR-specific helpers (not part of the public adapter API) ──────────

// User Hub events arrive as arrays of { action, data }
// action: 0=new, 1=update
interface UserHubItem<T> {
  action: number;
  data: T;
}

// SignalR may deliver user hub items as a single array arg or as spread args
function normalizeUserHubArgs<T>(args: unknown[]): UserHubItem<T>[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args as UserHubItem<T>[];
}

// ── ProjectX Realtime Adapter ─────────────────────────────────────────────

export class ProjectXRealtimeAdapter implements RealtimeAdapter {
  private marketHub: signalR.HubConnection | null = null;
  private userHub:   signalR.HubConnection | null = null;

  private quoteHandlers:      QuoteHandler[]      = [];
  private depthHandlers:      DepthHandler[]      = [];
  private orderHandlers:      OrderHandler[]      = [];
  private positionHandlers:   PositionHandler[]   = [];
  private accountHandlers:    AccountHandler[]    = [];
  private tradeHandlers:      TradeHandler[]      = [];
  private marketTickHandlers: MarketTickHandler[] = [];

  private subscribedQuotes: Set<string> = new Set();
  private subscribedDepth: Set<string> = new Set();
  private lastQuote: Map<string, Quote> = new Map();
  private subscribedOrderAccounts: Set<string> = new Set();
  private connectingPromise: Promise<void> | null = null;
  private userReconnectHandlers: (() => void)[] = [];
  private marketReconnectHandlers: (() => void)[] = [];

  async connect() {
    if (this.isConnected()) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = this.doConnect();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async doConnect() {
    // Connect through the backend proxy — JWT is injected server-side.
    // The proxy handles negotiate (HTTP) and WebSocket upgrade, so the
    // browser never sees the token.
    this.marketHub = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/market', {
        skipNegotiation: true,
        transport: HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.userHub = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/user', {
        skipNegotiation: true,
        transport: HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // Market hub: GatewayQuote has two params (contractId, data)
    this.marketHub.on('GatewayQuote', (contractId: string, data: Quote) => {
      this.lastQuote.set(contractId, data);
      this.quoteHandlers.forEach((h) => h(contractId, data));
    });

    // Market hub: GatewayTrade — dispatch fills as MarketTick[] and synthesize quote update.
    // GatewayQuote only fires on best-bid/ask changes and can go silent;
    // trades fire on every fill, so we synthesize a quote update from them.
    this.marketHub.on('GatewayTrade', (contractId: string, trades: unknown) => {
      const arr = Array.isArray(trades) ? trades : [trades];

      // Dispatch to market tick handlers (for FRVP trade volume accumulation)
      if (this.marketTickHandlers.length > 0) {
        const ticks: MarketTick[] = [];
        for (const t of arr) {
          const raw = t as { price?: number; Price?: number; size?: number; Size?: number; volume?: number; Volume?: number; timestamp?: string };
          const price = raw.price ?? raw.Price;
          const size = raw.size ?? raw.Size ?? raw.volume ?? raw.Volume ?? 1;
          if (price && price > 0) {
            ticks.push({ price, size, timestampMs: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now() });
          }
        }
        if (ticks.length > 0) this.marketTickHandlers.forEach((h) => h(contractId, ticks));
      }

      const last = arr[arr.length - 1] as { price?: number; timestamp?: string } | undefined;
      if (!last?.price) return;

      const prev = this.lastQuote.get(contractId);
      const synthetic: Quote = {
        symbol: prev?.symbol ?? '',
        symbolName: prev?.symbolName ?? '',
        lastPrice: last.price,
        bestBid: prev?.bestBid ?? last.price,
        bestAsk: prev?.bestAsk ?? last.price,
        change: prev?.change ?? 0,
        changePercent: prev?.changePercent ?? 0,
        open: prev?.open ?? last.price,
        high: Math.max(prev?.high ?? last.price, last.price),
        low: Math.min(prev?.low ?? last.price, last.price),
        volume: (prev?.volume ?? 0) + arr.length,
        lastUpdated: last.timestamp ?? new Date().toISOString(),
        timestamp: last.timestamp ?? new Date().toISOString(),
      };
      this.lastQuote.set(contractId, synthetic);
      this.quoteHandlers.forEach((h) => h(contractId, synthetic));
    });

    // Market hub: GatewayDepth has two params (contractId, entries[])
    this.marketHub.on('GatewayDepth', (contractId: string, entries: (DepthEntry | null)[]) => {
      const valid = entries.filter((e): e is DepthEntry => e != null);
      this.depthHandlers.forEach((h) => h(contractId, valid));
    });

    // User hub events — may arrive as a single array arg OR spread args.
    // ProjectX delivers numeric IDs; normalize to strings at the boundary.
    this.userHub.on('GatewayUserOrder', (...args: unknown[]) => {
      const items = normalizeUserHubArgs<RealtimeOrder>(args);
      for (const item of items) {
        const d = item.data;
        const order: RealtimeOrder = { ...d, id: String(d.id), accountId: String(d.accountId) };
        this.orderHandlers.forEach((h) => h(order, item.action));
      }
    });
    this.userHub.on('GatewayUserPosition', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimePosition>(args)) {
        const d = item.data;
        const pos: RealtimePosition = { ...d, id: String(d.id), accountId: String(d.accountId) };
        this.positionHandlers.forEach((h) => h(pos, item.action));
      }
    });
    this.userHub.on('GatewayUserAccount', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeAccount>(args)) {
        const d = item.data;
        const acct: RealtimeAccount = { ...d, id: String(d.id) };
        this.accountHandlers.forEach((h) => h(acct, item.action));
      }
    });
    this.userHub.on('GatewayUserTrade', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeTrade>(args)) {
        const d = item.data;
        const trade: RealtimeTrade = { ...d, id: String(d.id), accountId: String(d.accountId), orderId: String(d.orderId) };
        this.tradeHandlers.forEach((h) => h(trade, item.action));
      }
    });

    // Resubscribe on reconnect
    this.marketHub.onreconnected(() => {
      for (const contractId of this.subscribedQuotes) {
        this.marketHub?.invoke('SubscribeContractQuotes', contractId).catch(console.error);
        this.marketHub?.invoke('SubscribeContractTrades', contractId).catch(console.error);
      }
      for (const contractId of this.subscribedDepth) {
        this.marketHub?.invoke('SubscribeContractMarketDepth', contractId).catch(console.error);
      }
      this.marketReconnectHandlers.forEach((h) => h());
    });
    this.userHub.onreconnected(() => {
      for (const accountId of this.subscribedOrderAccounts) {
        this.flushUserSubscriptions(accountId);
      }
      this.userReconnectHandlers.forEach((h) => h());
    });

    await this.marketHub.start();
    await this.userHub.start();

    // Flush any subscriptions that were requested before connection was ready
    for (const contractId of this.subscribedQuotes) {
      this.marketHub.invoke('SubscribeContractQuotes', contractId).catch(console.error);
      this.marketHub.invoke('SubscribeContractTrades', contractId).catch(console.error);
    }
    for (const contractId of this.subscribedDepth) {
      this.marketHub.invoke('SubscribeContractMarketDepth', contractId).catch(console.error);
    }
    for (const accountId of this.subscribedOrderAccounts) {
      this.flushUserSubscriptions(accountId);
    }
  }

  async disconnect() {
    await this.marketHub?.stop();
    await this.userHub?.stop();
    this.marketHub = null;
    this.userHub   = null;
    this.subscribedQuotes.clear();
    this.subscribedDepth.clear();
    this.subscribedOrderAccounts.clear();
  }

  isConnected(): boolean {
    return this.marketHub?.state === signalR.HubConnectionState.Connected;
  }

  // ── Market hub subscriptions ───────────────────────────────────────────

  subscribeQuotes(contractId: string) {
    this.subscribedQuotes.add(contractId);
    if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('SubscribeContractQuotes', contractId).catch(console.error);
      this.marketHub.invoke('SubscribeContractTrades', contractId).catch(console.error);
    }
  }

  unsubscribeQuotes(contractId: string) {
    this.subscribedQuotes.delete(contractId);
    this.lastQuote.delete(contractId);
    if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('UnsubscribeContractQuotes', contractId).catch(console.error);
      this.marketHub.invoke('UnsubscribeContractTrades', contractId).catch(console.error);
    }
  }

  subscribeDepth(contractId: string) {
    this.subscribedDepth.add(contractId);
    if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('SubscribeContractMarketDepth', contractId).catch(console.error);
    }
  }

  unsubscribeDepth(contractId: string) {
    this.subscribedDepth.delete(contractId);
    if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('UnsubscribeContractMarketDepth', contractId).catch(console.error);
    }
  }

  // ── User hub subscriptions ────────────────────────────────────────────

  subscribeUserEvents(accountId: string) {
    this.subscribedOrderAccounts.add(accountId);
    if (this.userHub?.state === signalR.HubConnectionState.Connected) {
      this.flushUserSubscriptions(accountId);
    }
  }

  private flushUserSubscriptions(accountId: string) {
    const numericId = Number(accountId);
    this.userHub?.invoke('SubscribeAccounts').catch(console.error);
    this.userHub?.invoke('SubscribeOrders', numericId).catch(console.error);
    this.userHub?.invoke('SubscribePositions', numericId).catch(console.error);
    this.userHub?.invoke('SubscribeTrades', numericId).catch(console.error);
  }

  // ── Event handlers ────────────────────────────────────────────────────

  onQuote(handler: QuoteHandler)       { this.quoteHandlers.push(handler); }
  onOrder(handler: OrderHandler)       { this.orderHandlers.push(handler); }
  onPosition(handler: PositionHandler) { this.positionHandlers.push(handler); }
  onAccount(handler: AccountHandler)   { this.accountHandlers.push(handler); }

  onDepth(handler: DepthHandler)         { this.depthHandlers.push(handler); }
  offQuote(handler: QuoteHandler)       { this.quoteHandlers    = this.quoteHandlers.filter((h) => h !== handler); }
  offDepth(handler: DepthHandler)       { this.depthHandlers    = this.depthHandlers.filter((h) => h !== handler); }
  offOrder(handler: OrderHandler)       { this.orderHandlers    = this.orderHandlers.filter((h) => h !== handler); }
  offPosition(handler: PositionHandler) { this.positionHandlers = this.positionHandlers.filter((h) => h !== handler); }
  offAccount(handler: AccountHandler)   { this.accountHandlers  = this.accountHandlers.filter((h) => h !== handler); }

  onTrade(handler: TradeHandler)             { this.tradeHandlers.push(handler); }
  offTrade(handler: TradeHandler)            { this.tradeHandlers       = this.tradeHandlers.filter((h) => h !== handler); }

  onMarketTick(handler: MarketTickHandler)   { this.marketTickHandlers.push(handler); }
  offMarketTick(handler: MarketTickHandler)  { this.marketTickHandlers  = this.marketTickHandlers.filter((h) => h !== handler); }

  onUserReconnect(handler: () => void)  { this.userReconnectHandlers.push(handler); }
  offUserReconnect(handler: () => void) { this.userReconnectHandlers = this.userReconnectHandlers.filter((h) => h !== handler); }

  onMarketReconnect(handler: () => void)  { this.marketReconnectHandlers.push(handler); }
  offMarketReconnect(handler: () => void) { this.marketReconnectHandlers = this.marketReconnectHandlers.filter((h) => h !== handler); }

  /** Measure WebSocket round-trip latency in ms. Returns -1 if not connected. */
  async ping(): Promise<number> {
    if (!this.marketHub || this.marketHub.state !== signalR.HubConnectionState.Connected) return -1;
    const start = performance.now();
    try {
      await this.marketHub.invoke('Ping');
    } catch {
      // Server may not support Ping, but the error still travels the WebSocket round-trip
    }
    return Math.round(performance.now() - start);
  }
}
