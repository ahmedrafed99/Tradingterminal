import type { Request, Response, NextFunction } from 'express';
import type * as http from 'http';
import type { Duplex } from 'stream';
import { OrderType, OrderSide } from '../types/enums';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface ConnectParams {
  exchange: string;
  credentials: Record<string, string>;
  baseUrl?: string;
}

export interface ExchangeAuth {
  connect(params: ConnectParams): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getStatus(): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export interface ExchangeAccounts {
  list(): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Market Data
// ---------------------------------------------------------------------------
export interface ExchangeMarketData {
  retrieveBars(params: Record<string, unknown>): Promise<unknown>;
  searchContracts(searchText: string, live: boolean): Promise<unknown>;
  availableContracts(live: boolean): Promise<unknown>;
  searchContractById(contractId: string, live: boolean): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Bracket leg — either tick-offset (ProjectX) or absolute-price (Hyperliquid).
 * Adapters narrow to the correct variant at their boundary.
 */
export type BracketParam =
  | { ticks: number; type: number }
  | { price: number; size?: number };

/** Canonical params for placing an order — shared by route validation and adapters. */
export interface PlaceOrderParams {
  accountId: string;
  contractId: string;
  type: OrderType;
  side: OrderSide;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossBracket?: BracketParam;
  /** Array of TP legs. Adapters convert to exchange-specific format. */
  takeProfitBrackets?: BracketParam[];
}

export interface ExchangeOrders {
  place(params: PlaceOrderParams): Promise<unknown>;
  cancel(params: { accountId: string; orderId: string }): Promise<unknown>;
  modify(params: Record<string, unknown>): Promise<unknown>;
  searchOpen(accountId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export interface ExchangePositions {
  searchOpen(accountId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
export interface ExchangeTrades {
  search(params: {
    accountId: string;
    startTimestamp: string;
    endTimestamp?: string;
  }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Realtime (SignalR proxy or native WebSocket multiplexer)
// ---------------------------------------------------------------------------
export interface SignalRRealtime {
  kind: 'signalr';
  /** Proxies SignalR negotiate HTTP requests to the exchange RTC server. */
  negotiateMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Proxies WebSocket upgrades (/hubs/*) to the exchange RTC server. */
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export interface NativeWsRealtime {
  kind: 'ws';
  /** Path the backend listens on for browser WebSocket connections, e.g. '/ws/hl'. */
  wsPath: string;
  /** Accepts a WebSocket upgrade and multiplexes it to the upstream exchange WS. */
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export type ExchangeRealtime = SignalRRealtime | NativeWsRealtime;

// ---------------------------------------------------------------------------
// Composite adapter
// ---------------------------------------------------------------------------
export interface ExchangeAdapter {
  readonly name: string;
  readonly auth: ExchangeAuth;
  readonly accounts: ExchangeAccounts;
  readonly marketData: ExchangeMarketData;
  readonly orders: ExchangeOrders;
  readonly positions: ExchangePositions;
  readonly trades: ExchangeTrades;
  readonly realtime?: ExchangeRealtime;
}
