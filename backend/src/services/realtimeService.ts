/**
 * Backend SignalR client + WebSocket forwarder.
 *
 * One marketHub (shared; token stays live by tracking the current owner).
 * One userHub per connected account — user-hub events are identity-scoped,
 * so a single hub only delivers events for the authenticated user's accounts.
 *
 * Forwards events to connected frontend WebSocket clients and emits them
 * internally for backend consumers (bracketEngine, etc.).
 */

import * as signalR from '@microsoft/signalr';
import { EventEmitter } from 'events';
import type WebSocket from 'ws';
import { debugLog } from '../utils/debugLog';

// ---------------------------------------------------------------------------
// Minimal realtime types (mirrors frontend/src/adapters/types.ts)
// ---------------------------------------------------------------------------

export interface RealtimeOrder {
  id: string;
  accountId: string;
  contractId: string;
  status: number;
  type: number;
  side: number;
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
  private connectingMarket: Promise<void> | null = null;

  // Per-connection user hubs
  private userHubs = new Map<string, signalR.HubConnection>(); // connectionId → hub
  // Guards against concurrent connect() calls for the same connectionId
  private connectingUsers = new Map<string, Promise<void>>(); // connectionId → in-progress promise

  // Token store used by the market hub's accessTokenFactory at reconnect time
  private connectionTokens = new Map<string, string>(); // connectionId → token
  private marketHubOwner: string | null = null;          // which connectionId backs market hub

  // Subscription tracking (for re-subscribe on reconnect)
  private subscribedQuotes  = new Map<string, number>(); // contractId → refcount
  private subscribedDepth   = new Map<string, number>(); // contractId → refcount
  private subscribedAccounts = new Set<string>();         // accountIds pending/active subscription
  private accountToConnection = new Map<string, string>(); // accountId → connectionId (within service)

  // Connected frontend WS clients
  private clients = new Set<WebSocket>();

  // ── Public connection lifecycle ────────────────────────────────────────────

  isRunning(): boolean { return this.isConnected(); }

  isConnected(): boolean {
    return this.marketHub?.state === signalR.HubConnectionState.Connected;
  }

  /**
   * Start (or join) the shared market hub, then start a dedicated user hub for
   * this connection. Safe to call for every account — market hub is started only
   * once, user hub is always per-connection.
   *
   * Call `registerConnectionAccounts` BEFORE this so that the user hub's initial
   * subscription flush routes to the right hub.
   */
  async connect(connectionId: string, token: string, rtcBaseUrl: string): Promise<void> {
    this.connectionTokens.set(connectionId, token);

    // Market hub: start once, stay up as long as any user is connected.
    // accessTokenFactory reads from connectionTokens[marketHubOwner] at reconnect time,
    // so it remains valid even after the original owner disconnects.
    if (!this.isConnected()) {
      this.marketHubOwner = connectionId;
      if (this.connectingMarket) {
        await this.connectingMarket;
      } else {
        this.connectingMarket = this._startMarketHub(rtcBaseUrl);
        try { await this.connectingMarket; } finally { this.connectingMarket = null; }
      }
    }

    // User hub: serialize concurrent connect() calls for the same connectionId.
    // Without this, two simultaneous calls (e.g. two profiles with the same username)
    // both enter _startUserHub, the second calls stop() on the hub the first just
    // created (still in Connecting state), causing SignalR to reject the first start().
    const pending = this.connectingUsers.get(connectionId);
    if (pending) await pending.catch(() => {});

    const p = this._startUserHub(connectionId, token, rtcBaseUrl);
    this.connectingUsers.set(connectionId, p);
    try {
      await p;
    } finally {
      if (this.connectingUsers.get(connectionId) === p) this.connectingUsers.delete(connectionId);
    }
  }

  /**
   * Register which accountIds belong to a connection so subscriptions can be
   * flushed to the right user hub. Must be called before `connect()` so the
   * initial hub-start flush routes correctly.
   */
  registerConnectionAccounts(connectionId: string, accountIds: string[]): void {
    for (const aid of accountIds) {
      this.accountToConnection.set(aid, connectionId);
    }
  }

  /**
   * Disconnect just this account's user hub. The market hub and all other user
   * hubs stay running. If this was the last account, tears down the market hub too.
   */
  async disconnectUser(connectionId: string): Promise<void> {
    const hub = this.userHubs.get(connectionId);
    if (hub) {
      await hub.stop().catch(() => {});
      this.userHubs.delete(connectionId);
    }
    this.connectionTokens.delete(connectionId);

    // Remove account → connection mappings for this user
    for (const [aid, cid] of this.accountToConnection) {
      if (cid === connectionId) this.accountToConnection.delete(aid);
    }

    // If the market hub was backed by this connection's token, hand off to a survivor
    if (this.marketHubOwner === connectionId) {
      this.marketHubOwner = [...this.connectionTokens.keys()][0] ?? null;
      // accessTokenFactory reads marketHubOwner at call time — no rebuild needed
    }

    // Tear down market hub when no user hubs remain
    if (this.userHubs.size === 0) {
      await this.marketHub?.stop().catch(() => {});
      this.marketHub    = null;
      this.marketHubOwner = null;
      this.subscribedQuotes.clear();
      this.subscribedDepth.clear();
      this.subscribedAccounts.clear();
      this.accountToConnection.clear();
      debugLog.log('realtimeService:disconnected', { reason: 'last user hub gone' });
    }
  }

  /** Full teardown — all hubs, all subscriptions. */
  async disconnect(): Promise<void> {
    for (const hub of this.userHubs.values()) {
      await hub.stop().catch(() => {});
    }
    this.userHubs.clear();
    await this.marketHub?.stop().catch(() => {});
    this.marketHub    = null;
    this.marketHubOwner = null;
    this.connectionTokens.clear();
    this.subscribedQuotes.clear();
    this.subscribedDepth.clear();
    this.subscribedAccounts.clear();
    this.accountToConnection.clear();
    debugLog.log('realtimeService:disconnected', { reason: 'full teardown' });
  }

  // ── Frontend WebSocket client management ──────────────────────────────────

  registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    const marketState = this.marketHub?.state ?? 'disconnected';
    this._sendToClient(ws, { event: 'hubState', hub: 'market', state: this._mapState(marketState) });
    // Report user hub state as connected if any user hub is up
    const anyUserConnected = [...this.userHubs.values()].some(
      (h) => h.state === signalR.HubConnectionState.Connected,
    );
    this._sendToClient(ws, { event: 'hubState', hub: 'user', state: anyUserConnected ? 'connected' : 'disconnected' });

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
      case 'subscribeUser':     if (accountId)  this.subscribeUserEvents(accountId); break;
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
    const connectionId = this.accountToConnection.get(accountId);
    const hub = connectionId ? this.userHubs.get(connectionId) : undefined;
    if (hub?.state === signalR.HubConnectionState.Connected) {
      this._flushAccountSubscription(accountId, hub);
    }
  }

  unsubscribeUserEvents(accountId: string): void {
    this.subscribedAccounts.delete(accountId);
    // ProjectX doesn't expose Unsubscribe* for user hub events
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

  private _flushAccountSubscription(accountId: string, hub: signalR.HubConnection): void {
    const numericId = Number(accountId);
    hub.invoke('SubscribeAccounts').catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeAccounts', error: String(e) }));
    hub.invoke('SubscribeOrders',    numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeOrders',    accountId, error: String(e) }));
    hub.invoke('SubscribePositions', numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribePositions', accountId, error: String(e) }));
    hub.invoke('SubscribeTrades',    numericId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeTrades',    accountId, error: String(e) }));
  }

  // ── SignalR: market hub ────────────────────────────────────────────────────

  private async _startMarketHub(rtcBaseUrl: string): Promise<void> {
    this.marketHub = new signalR.HubConnectionBuilder()
      .withUrl(`${rtcBaseUrl}/hubs/market`, {
        // Reads the current owner's token at every (re)connect, surviving ownership hand-off
        accessTokenFactory: () =>
          (this.marketHubOwner ? this.connectionTokens.get(this.marketHubOwner) : null) ?? '',
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.marketHub.on('GatewayQuote', (contractId: string, data: unknown) => {
      this._broadcast({ event: 'GatewayQuote', contractId, data });
      this.emit('quote', contractId, data);
    });

    this.marketHub.on('GatewayTrade', (contractId: string, trades: unknown) => {
      const arr = Array.isArray(trades) ? trades : [trades];
      this._broadcast({ event: 'GatewayTrade', contractId, data: arr });
      this.emit('tick', contractId, arr);
    });

    this.marketHub.on('GatewayDepth', (contractId: string, entries: unknown) => {
      const arr = Array.isArray(entries) ? entries.filter(Boolean) : [];
      this._broadcast({ event: 'GatewayDepth', contractId, data: arr });
      this.emit('depth', contractId, arr);
    });

    this.marketHub.on('gatewaylogout', () => {
      debugLog.log('realtimeService:gatewaylogout', { hub: 'market' });
    });

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

    await this.marketHub.start();
    this._broadcast({ event: 'hubState', hub: 'market', state: 'connected' });

    // Flush any pre-subscribed contracts
    for (const contractId of this.subscribedQuotes.keys()) {
      this.marketHub.invoke('SubscribeContractQuotes', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractQuotes', contractId, error: String(e) }));
      this.marketHub.invoke('SubscribeContractTrades', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractTrades', contractId, error: String(e) }));
    }
    for (const contractId of this.subscribedDepth.keys()) {
      this.marketHub.invoke('SubscribeContractMarketDepth', contractId).catch((e) => debugLog.log('realtimeService:invokeError', { method: 'SubscribeContractMarketDepth', contractId, error: String(e) }));
    }

    debugLog.log('realtimeService:market:connected', { rtcBaseUrl });
  }

  // ── SignalR: user hub (one per connection) ─────────────────────────────────

  private async _startUserHub(connectionId: string, token: string, rtcBaseUrl: string): Promise<void> {
    // Stop any existing hub for this connection
    const existing = this.userHubs.get(connectionId);
    if (existing) {
      await existing.stop().catch(() => {});
      this.userHubs.delete(connectionId);
    }

    const hub = new signalR.HubConnectionBuilder()
      .withUrl(`${rtcBaseUrl}/hubs/user`, {
        accessTokenFactory: () => token,
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this._wireUserHubEvents(hub, connectionId);
    this.userHubs.set(connectionId, hub);
    await hub.start();
    this._broadcast({ event: 'hubState', hub: 'user', state: 'connected' });

    // Flush pending subscriptions for accounts belonging to this connection
    for (const accountId of this.subscribedAccounts) {
      if (this.accountToConnection.get(accountId) === connectionId) {
        this._flushAccountSubscription(accountId, hub);
      }
    }

    debugLog.log('realtimeService:user:connected', { connectionId, rtcBaseUrl });
  }

  private _wireUserHubEvents(hub: signalR.HubConnection, connectionId: string): void {
    hub.on('GatewayUserOrder', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeOrder>(args)) {
        const data = item.data;
        const order: RealtimeOrder = { ...data, id: String(data.id), accountId: String(data.accountId) };
        this._broadcast({ event: 'GatewayUserOrder', action: item.action, data: order });
        this.emit('order', order, item.action);
      }
    });

    hub.on('GatewayUserPosition', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimePosition>(args)) {
        const data = item.data;
        const pos: RealtimePosition = { ...data, id: String(data.id), accountId: String(data.accountId) };
        this._broadcast({ event: 'GatewayUserPosition', action: item.action, data: pos });
        this.emit('position', pos, item.action);
      }
    });

    hub.on('GatewayUserAccount', (...args: unknown[]) => {
      for (const item of normalizeUserHubArgs<RealtimeAccount>(args)) {
        const data = item.data;
        const acct: RealtimeAccount = { ...data, id: String(data.id) };
        this._broadcast({ event: 'GatewayUserAccount', action: item.action, data: acct });
        this.emit('account', acct, item.action);
      }
    });

    hub.on('GatewayUserTrade', (...args: unknown[]) => {
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

    hub.on('gatewaylogout', () => {
      debugLog.log('realtimeService:gatewaylogout', { hub: 'user', connectionId });
    });

    hub.onreconnecting(() => {
      this._broadcast({ event: 'hubState', hub: 'user', state: 'reconnecting' });
      debugLog.log('realtimeService:user:reconnecting', { connectionId });
    });

    hub.onreconnected(() => {
      // Re-subscribe only this connection's accounts
      for (const accountId of this.subscribedAccounts) {
        if (this.accountToConnection.get(accountId) === connectionId) {
          this._flushAccountSubscription(accountId, hub);
        }
      }
      this._broadcast({ event: 'hubState', hub: 'user', state: 'connected' });
      debugLog.log('realtimeService:user:reconnected', { connectionId });
    });

    hub.onclose(() => {
      // Only broadcast "disconnected" when ALL user hubs are gone
      const anyUp = [...this.userHubs.values()].some(
        (h) => h !== hub && h.state === signalR.HubConnectionState.Connected,
      );
      if (!anyUp) {
        this._broadcast({ event: 'hubState', hub: 'user', state: 'disconnected' });
      }
      debugLog.log('realtimeService:user:closed', { connectionId });
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const realtimeService = new BackendRealtimeService();
