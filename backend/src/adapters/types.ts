import type { Request, Response, NextFunction } from 'express';
import type * as http from 'http';
import type { Duplex } from 'stream';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface ConnectParams {
  username: string;
  apiKey: string;
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
  cancel(params: { accountId: number; orderId: number }): Promise<unknown>;
  modify(params: Record<string, unknown>): Promise<unknown>;
  searchOpen(accountId: number): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
export interface ExchangeTrades {
  search(params: {
    accountId: number;
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
  readonly trades: ExchangeTrades;
  readonly realtime: ExchangeRealtime;
}
