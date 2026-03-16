import { OrderType, OrderSide, OrderStatus, PositionType, DepthType } from '../types/enums';

// ── Canonical data types ──────────────────────────────────────────────────
// These are exchange-agnostic shapes. Each adapter normalizes incoming
// exchange-specific payloads into these before dispatching to handlers.

export interface Quote {
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

export interface DepthEntry {
  price: number;
  volume: number;
  currentVolume: number;
  type: DepthType;
  timestamp: string;
}

export interface RealtimeOrder {
  id: string;
  accountId: string;
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
  customTag?: string;
}

export interface RealtimePosition {
  id: string;
  accountId: string;
  contractId: string;
  type: PositionType;
  size: number;          // 0 when closed
  averagePrice: number;
}

export interface RealtimeAccount {
  id: string;
  name: string;
  balance: number;
  canTrade: boolean;
  isVisible: boolean;
  simulated: boolean;
}

export interface RealtimeTrade {
  id: string;
  accountId: string;
  contractId: string;
  price: number;
  fees: number;
  side: OrderSide;
  size: number;
  voided: boolean;
  orderId: string;
}

// ── Handler type aliases ──────────────────────────────────────────────────

export type QuoteHandler    = (contractId: string, data: Quote) => void;
export type DepthHandler    = (contractId: string, entries: DepthEntry[]) => void;
export type OrderHandler    = (order: RealtimeOrder, action: number) => void;
export type PositionHandler = (position: RealtimePosition, action: number) => void;
export type AccountHandler  = (account: RealtimeAccount, action: number) => void;
export type TradeHandler    = (trade: RealtimeTrade, action: number) => void;

// ── Adapter interface ─────────────────────────────────────────────────────

export interface RealtimeAdapter {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Market subscriptions
  subscribeQuotes(contractId: string): void;
  unsubscribeQuotes(contractId: string): void;
  subscribeDepth(contractId: string): void;
  unsubscribeDepth(contractId: string): void;

  // User subscriptions
  subscribeUserEvents(accountId: string): void;

  // Event registration
  onQuote(handler: QuoteHandler): void;
  offQuote(handler: QuoteHandler): void;
  onDepth(handler: DepthHandler): void;
  offDepth(handler: DepthHandler): void;
  onOrder(handler: OrderHandler): void;
  offOrder(handler: OrderHandler): void;
  onPosition(handler: PositionHandler): void;
  offPosition(handler: PositionHandler): void;
  onAccount(handler: AccountHandler): void;
  offAccount(handler: AccountHandler): void;
  onTrade(handler: TradeHandler): void;
  offTrade(handler: TradeHandler): void;
  onUserReconnect(handler: () => void): void;
  offUserReconnect(handler: () => void): void;

  // Utility
  ping(): Promise<number>;
}
