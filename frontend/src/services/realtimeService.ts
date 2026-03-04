import * as signalR from '@microsoft/signalr';
import { HttpTransportType } from '@microsoft/signalr';
import { OrderType, OrderSide, OrderStatus, PositionType, DepthType } from '../types/enums';

export interface GatewayQuote {
  symbol: string;
  symbolName: string;
  lastPrice: number;
  bestBid: number;
  bestAsk: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  lastUpdated: string;
  timestamp: string;
}

export interface RealtimeOrder {
  id: number;
  accountId: number;
  contractId: string;
  symbolId?: string;
  status: OrderStatus;
  type: OrderType;
  side: OrderSide;
  size: number;
  fillVolume?: number;
  filledPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface RealtimePosition {
  id: number;
  accountId: number;
  contractId: string;
  type: PositionType;
  size: number;          // 0 when closed
  averagePrice: number;
}

export interface RealtimeAccount {
  id: number;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
  simulated: boolean;
}

export interface RealtimeTrade {
  id: number;
  accountId: number;
  contractId: string;
  price: number;
  fees: number;
  side: OrderSide;
  size: number;
  voided: boolean;
  orderId: number;
}

export interface DepthEntry {
  price: number;
  volume: number;
  currentVolume: number;
  type: DepthType;
  timestamp: string;
}

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

type QuoteHandler    = (contractId: string, data: GatewayQuote) => void;
type DepthHandler    = (contractId: string, entries: DepthEntry[]) => void;
type OrderHandler    = (order: RealtimeOrder, action: number) => void;
type PositionHandler = (position: RealtimePosition, action: number) => void;
type AccountHandler  = (account: RealtimeAccount, action: number) => void;
type TradeHandler    = (trade: RealtimeTrade, action: number) => void;

class RealtimeService {
  private marketHub: signalR.HubConnection | null = null;
  private userHub:   signalR.HubConnection | null = null;

  private quoteHandlers:    QuoteHandler[]    = [];
  private depthHandlers:    DepthHandler[]    = [];
  private orderHandlers:    OrderHandler[]    = [];
  private positionHandlers: PositionHandler[] = [];
  private accountHandlers:  AccountHandler[]  = [];
  private tradeHandlers:    TradeHandler[]    = [];

  private subscribedQuotes: Set<string> = new Set();
  private subscribedDepth: Set<string> = new Set();
  private subscribedOrderAccounts: Set<number> = new Set();
  private connectingPromise: Promise<void> | null = null;
  private userReconnectHandlers: (() => void)[] = [];

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
    this.marketHub.on('GatewayQuote', (contractId: string, data: GatewayQuote) => {
      this.quoteHandlers.forEach((h) => h(contractId, data));
    });

    // Market hub: GatewayDepth has two params (contractId, entries[])
    this.marketHub.on('GatewayDepth', (contractId: string, entries: (DepthEntry | null)[]) => {
      const valid = entries.filter((e): e is DepthEntry => e != null);
      this.depthHandlers.forEach((h) => h(contractId, valid));
    });

    // User hub events — may arrive as a single array arg OR spread args
    this.userHub.on('GatewayUserOrder', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeOrder>(args)) {
        this.orderHandlers.forEach((h) => h(item.data, item.action));
      }
    });
    this.userHub.on('GatewayUserPosition', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimePosition>(args)) {
        this.positionHandlers.forEach((h) => h(item.data, item.action));
      }
    });
    this.userHub.on('GatewayUserAccount', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeAccount>(args)) {
        this.accountHandlers.forEach((h) => h(item.data, item.action));
      }
    });
    this.userHub.on('GatewayUserTrade', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeTrade>(args)) {
        this.tradeHandlers.forEach((h) => h(item.data, item.action));
      }
    });

    // Resubscribe on reconnect
    this.marketHub.onreconnected(() => {
      for (const contractId of this.subscribedQuotes) {
        this.marketHub?.invoke('SubscribeContractQuotes', contractId).catch(console.error);
      }
      for (const contractId of this.subscribedDepth) {
        this.marketHub?.invoke('SubscribeContractMarketDepth', contractId).catch(console.error);
      }
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
    }
  }

  unsubscribeQuotes(contractId: string) {
    this.subscribedQuotes.delete(contractId);
    if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('UnsubscribeContractQuotes', contractId).catch(console.error);
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

  subscribeUserEvents(accountId: number) {
    this.subscribedOrderAccounts.add(accountId);
    if (this.userHub?.state === signalR.HubConnectionState.Connected) {
      this.flushUserSubscriptions(accountId);
    }
  }

  private flushUserSubscriptions(accountId: number) {
    this.userHub?.invoke('SubscribeAccounts').catch(console.error);
    this.userHub?.invoke('SubscribeOrders', accountId).catch(console.error);
    this.userHub?.invoke('SubscribePositions', accountId).catch(console.error);
    this.userHub?.invoke('SubscribeTrades', accountId).catch(console.error);
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

  onTrade(handler: TradeHandler)       { this.tradeHandlers.push(handler); }
  offTrade(handler: TradeHandler)      { this.tradeHandlers    = this.tradeHandlers.filter((h) => h !== handler); }

  onUserReconnect(handler: () => void)  { this.userReconnectHandlers.push(handler); }
  offUserReconnect(handler: () => void) { this.userReconnectHandlers = this.userReconnectHandlers.filter((h) => h !== handler); }

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

export const realtimeService = new RealtimeService();
