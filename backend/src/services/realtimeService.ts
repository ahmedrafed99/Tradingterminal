/**
 * Backend SignalR client + WebSocket forwarder.
 *
 * Owns the sole SignalR connection to ProjectX (both /hubs/market and
 * /hubs/user). Forwards events to connected frontend WebSocket clients and
 * emits them internally for backend consumers (bracketEngine, etc.).
 *
 * Only one SignalR session is allowed per ProjectX account — this service
 * holds it. The frontend connects here via /ws/realtime instead of directly
 * to ProjectX.
 */

import * as signalR from '@microsoft/signalr';
import { EventEmitter } from 'events';
import type WebSocket from 'ws';
import { getRtcBaseUrl, getToken } from '../adapters/projectx/auth';
import { debugLog } from '../utils/debugLog';

// ---------------------------------------------------------------------------
// Minimal realtime types (mirrors frontend/src/adapters/types.ts)
// ---------------------------------------------------------------------------

export interface RealtimeOrder {
  id: string;
  accountId: string;
  contractId: string;
  status: number;           // OrderStatus enum value
  type: number;             // OrderType enum value
  side: number;             // OrderSide enum value
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
  type: number;
  size: number;
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
  side: number;
  size: number;
  voided: boolean;
  orderId: string;
}

// ---------------------------------------------------------------------------
// UserHub helper — events arrive as array of { action, data } or spread args
// ---------------------------------------------------------------------------

interface UserHubItem<T> { action: number; data: T; }

function normalizeUserHubArgs<T>(args: unknown[]): UserHubItem<T>[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0] as UserHubItem<T>[];
  return args as UserHubItem<T>[];
}

// ---------------------------------------------------------------------------
// BackendRealtimeService
// ---------------------------------------------------------------------------

class BackendRealtimeService extends EventEmitter {
  private marketHub: signalR.HubConnection | null = null;
  private userHub:   signalR.HubConnection | null = null;
  private connectingPromise: Promise<void> | null = null;

  // Subscription tracking (for re-subscribe on reconnect)
  private subscribedQuotes  = new Map<string, number>(); // contractId → refcount
  private subscribedDepth   = new Map<string, number>(); // contractId → refcount
  private subscribedAccounts = new Set<string>();

  // Connected frontend WS clients
  private clients = new Set<WebSocket>();

  // ── Public connection lifecycle ────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this._doConnect();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    await this.marketHub?.stop();
    await this.userHub?.stop();
    this.marketHub = null;
    this.userHub   = null;
    this.subscribedQuotes.clear();
    this.subscribedDepth.clear();
    this.subscribedAccounts.clear();
    debugLog.log('realtimeService:disconnected', {});
  }

  isConnected(): boolean {
    return this.marketHub?.state === signalR.HubConnectionState.Connected;
  }

  // ── Frontend WebSocket client management ──────────────────────────────────

  registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Immediately sync hub state to new client
    const marketState = this.marketHub?.state ?? 'disconnected';
    const userState   = this.userHub?.state   ?? 'disconnected';
    this._sendToClient(ws, { event: 'hubState', hub: 'market', state: this._mapState(marketState) });
    this._sendToClient(ws, { event: 'hubState', hub: 'user',   state: this._mapState(userState)   });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        this._handleClientCommand(ws, msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => this.clients.delete(ws));
    debugLog.log('realtimeService:clientConnected', { totalClients: this.clients.size });
  }

  private _handleClientCommand(ws: WebSocket, msg: Record<string, unknown>): void {
    const cmd        = msg['cmd'] as string | undefined;
    const contractId = msg['contractId'] as string | undefined;
    const accountId  = msg['accountId']  as string | undefined;

    switch (cmd) {
      case 'subscribeQuotes':   if (contractId) this.subscribeQuotes(contractId);   break;
      case 'unsubscribeQuotes': if (contractId) this.unsubscribeQuotes(contractId); break;
      case 'subscribeDepth':    if (contractId) this.subscribeDepth(contractId);    break;
      case 'unsubscribeDepth':  if (contractId) this.unsubscribeDepth(contractId);  break;
      case 'subscribeUser':     if (accountId)  this.subscribeUserEvents(accountId);break;
      case 'unsubscribeUser':   if (accountId)  this.unsubscribeUserEvents(accountId); break;
      case 'ping':
        this._sendToClient(ws, { event: 'pong', id: msg['id'] });
        break;
      default:
        debugLog.log('realtimeService:unknownCmd', { cmd });
    }
  }

  // ── Market hub subscriptions ───────────────────────────────────────────────

  subscribeQuotes(contractId: string): void {
    const prev = this.subscribedQuotes.get(contractId) ?? 0;
    this.subscribedQuotes.set(contractId, prev + 1);
    if (prev === 0 && this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('SubscribeContractQuotes', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractQuotes', contractId, error: String(e) }));
      this.marketHub.invoke('SubscribeContractTrades', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractTrades', contractId, error: String(e) }));
    }
  }

  unsubscribeQuotes(contractId: string): void {
    const prev = this.subscribedQuotes.get(contractId) ?? 0;
    if (prev <= 1) {
      this.subscribedQuotes.delete(contractId);
      if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
        this.marketHub.invoke('UnsubscribeContractQuotes', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'UnsubscribeContractQuotes', contractId, error: String(e) }));
        this.marketHub.invoke('UnsubscribeContractTrades', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'UnsubscribeContractTrades', contractId, error: String(e) }));
      }
    } else {
      this.subscribedQuotes.set(contractId, prev - 1);
    }
  }

  subscribeDepth(contractId: string): void {
    const prev = this.subscribedDepth.get(contractId) ?? 0;
    this.subscribedDepth.set(contractId, prev + 1);
    if (prev === 0 && this.marketHub?.state === signalR.HubConnectionState.Connected) {
      this.marketHub.invoke('SubscribeContractMarketDepth', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractMarketDepth', contractId, error: String(e) }));
    }
  }

  unsubscribeDepth(contractId: string): void {
    const prev = this.subscribedDepth.get(contractId) ?? 0;
    if (prev <= 1) {
      this.subscribedDepth.delete(contractId);
      if (this.marketHub?.state === signalR.HubConnectionState.Connected) {
        this.marketHub.invoke('UnsubscribeContractMarketDepth', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'UnsubscribeContractMarketDepth', contractId, error: String(e) }));
      }
    } else {
      this.subscribedDepth.set(contractId, prev - 1);
    }
  }

  // ── User hub subscriptions ─────────────────────────────────────────────────

  subscribeUserEvents(accountId: string): void {
    this.subscribedAccounts.add(accountId);
    if (this.userHub?.state === signalR.HubConnectionState.Connected) {
      this._flushUserSubscriptions(accountId);
    }
  }

  unsubscribeUserEvents(accountId: string): void {
    this.subscribedAccounts.delete(accountId);
    // Note: ProjectX doesn't expose Unsubscribe* for user hub events
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private _sendToClient(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
    }
  }

  private _broadcast(payload: unknown): void {
    const json = JSON.stringify(payload);
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        try { ws.send(json); } catch { /* ignore */ }
      }
    }
  }

  private _mapState(state: signalR.HubConnectionState | string): string {
    if (state === signalR.HubConnectionState.Connected) return 'connected';
    if (state === signalR.HubConnectionState.Reconnecting) return 'reconnecting';
    return 'disconnected';
  }

  private _flushUserSubscriptions(accountId: string): void {
    const numericId = Number(accountId);
    this.userHub?.invoke('SubscribeAccounts').catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeAccounts', error: String(e) }));
    this.userHub?.invoke('SubscribeOrders',    numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeOrders', accountId, error: String(e) }));
    this.userHub?.invoke('SubscribePositions', numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribePositions', accountId, error: String(e) }));
    this.userHub?.invoke('SubscribeTrades',    numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeTrades', accountId, error: String(e) }));
  }

  // ── SignalR connection setup ───────────────────────────────────────────────

  private async _doConnect(): Promise<void> {
    const rtcBase = getRtcBaseUrl();

    this.marketHub = new signalR.HubConnectionBuilder()
      .withUrl(`${rtcBase}/hubs/market`, {
        accessTokenFactory: () => getToken() ?? '',
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.userHub = new signalR.HubConnectionBuilder()
      .withUrl(`${rtcBase}/hubs/user`, {
        accessTokenFactory: () => getToken() ?? '',
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // ── Market hub event handlers ──────────────────────────────────────────

    this.marketHub.on('GatewayQuote', (contractId: string, data: unknown) => {
      const payload = { event: 'GatewayQuote', contractId, data };
      this._broadcast(payload);
      this.emit('quote', contractId, data);
    });

    this.marketHub.on('GatewayTrade', (contractId: string, trades: unknown) => {
      const arr = Array.isArray(trades) ? trades : [trades];
      const payload = { event: 'GatewayTrade', contractId, data: arr };
      this._broadcast(payload);
      this.emit('tick', contractId, arr);
    });

    this.marketHub.on('GatewayDepth', (contractId: string, entries: unknown) => {
      const arr = Array.isArray(entries) ? entries.filter(Boolean) : [];
      this._broadcast({ event: 'GatewayDepth', contractId, data: arr });
      this.emit('depth', contractId, arr);
    });

    // ── Market hub lifecycle ───────────────────────────────────────────────

    this.marketHub.onreconnecting(() => {
      this._broadcast({ event: 'hubState', hub: 'market', state: 'reconnecting' });
      debugLog.log('realtimeService:market:reconnecting', {});
    });
    this.marketHub.onreconnected(() => {
      for (const contractId of this.subscribedQuotes.keys()) {
        this.marketHub?.invoke('SubscribeContractQuotes', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractQuotes', contractId, error: String(e) }));
        this.marketHub?.invoke('SubscribeContractTrades', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractTrades', contractId, error: String(e) }));
      }
      for (const contractId of this.subscribedDepth.keys()) {
        this.marketHub?.invoke('SubscribeContractMarketDepth', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractMarketDepth', contractId, error: String(e) }));
      }
      this._broadcast({ event: 'hubState', hub: 'market', state: 'connected' });
      debugLog.log('realtimeService:market:reconnected', {});
    });
    this.marketHub.onclose(() => {
      this._broadcast({ event: 'hubState', hub: 'market', state: 'disconnected' });
      debugLog.log('realtimeService:market:closed', {});
    });

    // ── User hub event handlers ────────────────────────────────────────────

    this.userHub.on('GatewayUserOrder', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeOrder>(args)) {
        const data = item.data;
        const order: RealtimeOrder = {
          ...data,
          id:        String(data.id),
          accountId: String(data.accountId),
        };
        this._broadcast({ event: 'GatewayUserOrder', action: item.action, data: order });
        this.emit('order', order, item.action);
      }
    });

    this.userHub.on('GatewayUserPosition', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimePosition>(args)) {
        const data = item.data;
        const pos: RealtimePosition = { ...data, id: String(data.id), accountId: String(data.accountId) };
        this._broadcast({ event: 'GatewayUserPosition', action: item.action, data: pos });
        this.emit('position', pos, item.action);
      }
    });

    this.userHub.on('GatewayUserAccount', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeAccount>(args)) {
        const data = item.data;
        const acct: RealtimeAccount = { ...data, id: String(data.id) };
        this._broadcast({ event: 'GatewayUserAccount', action: item.action, data: acct });
        this.emit('account', acct, item.action);
      }
    });

    this.userHub.on('GatewayUserTrade', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeTrade>(args)) {
        const data = item.data;
        const trade: RealtimeTrade = {
          ...data,
          id:        String(data.id),
          accountId: String(data.accountId),
          orderId:   String(data.orderId),
        };
        this._broadcast({ event: 'GatewayUserTrade', action: item.action, data: trade });
        this.emit('trade', trade, item.action);
      }
    });

    // ── User hub lifecycle ─────────────────────────────────────────────────

    this.userHub.onreconnecting(() => {
      this._broadcast({ event: 'hubState', hub: 'user', state: 'reconnecting' });
      debugLog.log('realtimeService:user:reconnecting', {});
    });
    this.userHub.onreconnected(() => {
      for (const accountId of this.subscribedAccounts) {
        this._flushUserSubscriptions(accountId);
      }
      this._broadcast({ event: 'hubState', hub: 'user', state: 'connected' });
      debugLog.log('realtimeService:user:reconnected', {});
    });
    this.userHub.onclose(() => {
      this._broadcast({ event: 'hubState', hub: 'user', state: 'disconnected' });
      debugLog.log('realtimeService:user:closed', {});
    });

    // ── Start both hubs ────────────────────────────────────────────────────

    await this.marketHub.start();
    await this.userHub.start();

    this._broadcast({ event: 'hubState', hub: 'market', state: 'connected' });
    this._broadcast({ event: 'hubState', hub: 'user',   state: 'connected' });

    // Flush any subscriptions that were requested before connection
    for (const contractId of this.subscribedQuotes.keys()) {
      this.marketHub.invoke('SubscribeContractQuotes', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractQuotes', contractId, error: String(e) }));
      this.marketHub.invoke('SubscribeContractTrades', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractTrades', contractId, error: String(e) }));
    }
    for (const contractId of this.subscribedDepth.keys()) {
      this.marketHub.invoke('SubscribeContractMarketDepth', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractMarketDepth', contractId, error: String(e) }));
    }
    for (const accountId of this.subscribedAccounts) {
      this._flushUserSubscriptions(accountId);
    }

    debugLog.log('realtimeService:connected', { rtcBase });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const realtimeService = new BackendRealtimeService();
