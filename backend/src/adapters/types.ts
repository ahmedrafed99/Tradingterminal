import type { Request, Response, NextFunction } from 'express';
import type * as http from 'http';
import type { Duplex } from 'stream';

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
export interface ExchangeOrders {
  place(params: Record<string, unknown>): Promise<unknown>;
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
// Realtime (SignalR / WebSocket proxy)
// ---------------------------------------------------------------------------
export interface ExchangeRealtime {
  negotiateMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  handleUpgrade: (
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
}

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
