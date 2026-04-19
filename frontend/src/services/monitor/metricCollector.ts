import { realtimeService } from '../realtimeService';
import type { NodeId, NodeMetrics, NodeState, HubConnectionState, Incident, MonitorSnapshot, ApiCategoryMetrics, ApiEndpointMetrics } from './types';
import { isFuturesMarketOpen } from '../../utils/marketHours';
import { consoleBuffer } from './consoleBuffer';

const WINDOW_MS = 10_000;
const SAMPLE_INTERVAL_MS = 1_000;
const BASELINE_SAMPLES = 10;

const DEGRADED_RATE_DROP = 0.20;
const DEGRADED_RAF_LAG_MS = 100;
const FROZEN_SILENCE_MS = 3_000;

// ---------------------------------------------------------------------------
// API category mapping
// ---------------------------------------------------------------------------

const API_CATEGORY: Record<string, string> = {
  '/market/bars':                   'Market Data',
  '/market/contracts/search':       'Market Data',
  '/market/contracts/available':    'Market Data',
  '/orders/place':                  'Orders',
  '/orders/cancel':                 'Orders',
  '/orders/modify':                 'Orders',
  '/orders/open':                   'Orders',
  '/auth/connect':                  'Auth',
  '/auth/disconnect':               'Auth',
  '/database/fetch/sync-all':       'Data Sync',
  '/database/fetch/cancel':         'Data Sync',
  '/settings':                      'Settings',
  '/credentials':                   'Settings',
  '/blacklist/sync':                'Settings',
};

function categoryFor(path: string): string {
  // Exact match first
  if (API_CATEGORY[path]) return API_CATEGORY[path];
  // Prefix match
  for (const [prefix, cat] of Object.entries(API_CATEGORY)) {
    if (path.startsWith(prefix)) return cat;
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// Internal per-node counters
// ---------------------------------------------------------------------------

interface NodeCounters {
  id: NodeId;
  label: string;
  tickTimestamps: number[];
  rafFrameTimes: number[];
  lastTickAt: number;
  ticksInWindow: number;
  state: NodeState;
  baselineRate: number;
  baselineSamples: number[];
  baselineLocked: boolean;
  // Hub nodes only
  hubState?: HubConnectionState;
  subEventTimestamps?: Record<string, number[]>; // event label → timestamps
}

function makeNode(id: NodeId, label: string, isHub = false): NodeCounters {
  return {
    id, label,
    tickTimestamps: [],
    rafFrameTimes: [],
    lastTickAt: 0,
    ticksInWindow: 0,
    state: 'normal',
    baselineRate: 0,
    baselineSamples: [],
    baselineLocked: false,
    ...(isHub ? { hubState: 'disconnected', subEventTimestamps: {} } : {}),
  };
}

// ---------------------------------------------------------------------------
// Per-endpoint API tracking
// ---------------------------------------------------------------------------

interface EndpointRecord {
  method: string;
  path: string;
  latencies: number[];
  callCount: number;
  lastCallAt: number; // performance.now()
  lastLatencyMs: number;
  lastOk: boolean;
}

// ---------------------------------------------------------------------------
// MetricCollector singleton
// ---------------------------------------------------------------------------

class MetricCollector {
  private nodes: Record<string, NodeCounters> = {
    'market-hub': makeNode('market-hub', 'Market Hub', true),
    'user-hub':   makeNode('user-hub',   'User Hub',   true),
    adapter:      makeNode('adapter',    'Adapter'),
    chart:        makeNode('chart',      'Chart'),
  };

  private incidents: Incident[] = [];
  private openIncidents = new Map<NodeId, Incident>();
  private sessionStartTime = 0;
  private priceByteOffset = 0;

  private rafId = 0;
  private lastSampleAt = 0;
  private lastRafAt = 0;
  private lastPingAt = 0;
  private hubRttMs = 0;
  private userHubRttMs = 0;
  private running = false;
  private stopConsole: (() => void) | null = null;

  private listeners = new Set<() => void>();

  private endpointRecords = new Map<string, EndpointRecord>();

  private snapshot: MonitorSnapshot = {
    nodes: [],
    incidents: [],
    apiCategories: [],
    worstState: 'normal',
    sessionStartTime: 0,
    marketOpen: false,
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.sessionStartTime = Date.now();
    this.lastSampleAt = performance.now();
    this.lastRafAt = performance.now();

    realtimeService.onQuote(this.onQuote);
    realtimeService.onOrder(this.onUserHubEvent);
    realtimeService.onTrade(this.onUserHubTrade);
    realtimeService.onPosition(this.onUserHubPosition);
    realtimeService.onMarketHubState(this.onMarketHubState);
    realtimeService.onUserHubState(this.onUserHubState);

    this.stopConsole = consoleBuffer.start();
    this.rafId = requestAnimationFrame(this.rafLoop);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.stopConsole?.();
    this.stopConsole = null;
    realtimeService.offQuote(this.onQuote);
    realtimeService.offOrder(this.onUserHubEvent);
    realtimeService.offTrade(this.onUserHubTrade);
    realtimeService.offPosition(this.onUserHubPosition);
    realtimeService.offMarketHubState(this.onMarketHubState);
    realtimeService.offUserHubState(this.onUserHubState);
    cancelAnimationFrame(this.rafId);
  }

  getSnapshot(): MonitorSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by API service layers after each real network request. */
  onApiCall(method: string, path: string, latencyMs: number, success: boolean) {
    const key = `${method}:${path}`;
    let ep = this.endpointRecords.get(key);
    if (!ep) {
      ep = { method, path, latencies: [], callCount: 0, lastCallAt: 0, lastLatencyMs: 0, lastOk: true };
      this.endpointRecords.set(key, ep);
    }
    ep.callCount++;
    ep.lastCallAt = performance.now();
    ep.lastOk = success;
    ep.lastLatencyMs = Math.round(latencyMs);
    ep.latencies.push(latencyMs);
    if (ep.latencies.length > 50) ep.latencies.shift();
    consoleBuffer.pushApi(method, path, latencyMs, success);
  }

  advancePriceOffset(bytes: number) {
    this.priceByteOffset += bytes;
  }

  getIncidents(): Incident[] {
    return this.incidents;
  }

  getSessionStartTime(): number {
    return this.sessionStartTime;
  }

  // ---------------------------------------------------------------------------
  // Hot-path handlers
  // ---------------------------------------------------------------------------

  private onQuote = () => {
    const now = performance.now();
    this.recordTick(this.nodes['market-hub'], now);
    this.recordSubEvent(this.nodes['market-hub'], 'Quotes', now);
    this.recordTick(this.nodes.adapter, now);
  };

  private onUserHubEvent = () => {
    const now = performance.now();
    this.recordTick(this.nodes['user-hub'], now);
    this.recordSubEvent(this.nodes['user-hub'], 'Orders', now);
  };

  private onUserHubTrade = () => {
    const now = performance.now();
    this.recordTick(this.nodes['user-hub'], now);
    this.recordSubEvent(this.nodes['user-hub'], 'Trades', now);
  };

  private onUserHubPosition = () => {
    const now = performance.now();
    this.recordTick(this.nodes['user-hub'], now);
    this.recordSubEvent(this.nodes['user-hub'], 'Positions', now);
  };

  private onMarketHubState = (state: HubConnectionState) => {
    const node = this.nodes['market-hub'];
    node.hubState = state;
    // Connection state drives node state directly
    if (state === 'connected') {
      node.state = 'normal';
    } else if (state === 'reconnecting') {
      node.state = 'degraded';
    } else {
      node.state = 'frozen';
    }
    this.rebuildSnapshot(performance.now(), isFuturesMarketOpen());
    this.notify();
  };

  private onUserHubState = (state: HubConnectionState) => {
    const node = this.nodes['user-hub'];
    node.hubState = state;
    if (state === 'connected') {
      node.state = 'normal';
    } else if (state === 'reconnecting') {
      node.state = 'degraded';
    } else {
      node.state = 'frozen';
    }
    this.rebuildSnapshot(performance.now(), isFuturesMarketOpen());
    this.notify();
  };

  private recordTick(node: NodeCounters, now: number) {
    node.lastTickAt = now;
    node.tickTimestamps.push(now);
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < node.tickTimestamps.length && node.tickTimestamps[i] < cutoff) i++;
    if (i > 0) node.tickTimestamps.splice(0, i);
  }

  private recordSubEvent(node: NodeCounters, label: string, now: number) {
    if (!node.subEventTimestamps) return;
    if (!node.subEventTimestamps[label]) node.subEventTimestamps[label] = [];
    const arr = node.subEventTimestamps[label];
    arr.push(now);
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < arr.length && arr[i] < cutoff) i++;
    if (i > 0) arr.splice(0, i);
  }

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------

  private rafLoop = (now: number) => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.rafLoop);

    const rafDelta = now - this.lastRafAt;
    this.lastRafAt = now;
    const chartNode = this.nodes.chart;
    chartNode.lastTickAt = now;
    chartNode.rafFrameTimes.push(rafDelta);
    if (chartNode.rafFrameTimes.length > 120) chartNode.rafFrameTimes.shift();

    if (now - this.lastSampleAt < SAMPLE_INTERVAL_MS) return;
    this.lastSampleAt = now;

    // Periodic WebSocket RTT ping every 5s
    if (now - this.lastPingAt > 5_000) {
      this.lastPingAt = now;
      realtimeService.ping().then((rtt) => { if (rtt >= 0) this.hubRttMs = rtt; });
      realtimeService.pingUserHub().then((rtt) => { if (rtt >= 0) this.userHubRttMs = rtt; });
    }

    const marketOpen = isFuturesMarketOpen();

    if (!marketOpen) {
      for (const node of Object.values(this.nodes)) {
        // Keep hub state-driven frozen if hub is actually disconnected
        if (node.id === 'market-hub' || node.id === 'user-hub') {
          if (node.hubState === 'connected') node.state = 'normal';
        } else {
          node.state = 'normal';
        }
      }
      if (this.incidents.length > 0) {
        this.incidents = [];
        this.openIncidents.clear();
      }
      this.rebuildSnapshot(now, false);
      this.notify();
      return;
    }

    // Hub nodes: state is driven by connection state callbacks, not tick rate
    // Only run tick-rate evaluation for adapter and chart
    this.evaluateNode(this.nodes.adapter, now, 0);

    const avgRaf = chartNode.rafFrameTimes.length
      ? chartNode.rafFrameTimes.reduce((a, b) => a + b, 0) / chartNode.rafFrameTimes.length
      : 16;
    this.evaluateNode(chartNode, now, avgRaf);

    this.rebuildSnapshot(now, true);
    this.notify();
  };

  private evaluateNode(node: NodeCounters, now: number, rafLag: number) {
    const windowMs = Math.min(WINDOW_MS, now - this.sessionStartTime + 1);
    const ratePerMin = node.id === 'chart'
      ? (node.rafFrameTimes.length / (WINDOW_MS / 1000)) * 60
      : (node.tickTimestamps.length / (windowMs / 1000)) * 60;

    if (!node.baselineLocked) {
      if (ratePerMin > 0) node.baselineSamples.push(ratePerMin);
      if (node.baselineSamples.length >= BASELINE_SAMPLES) {
        node.baselineRate = node.baselineSamples.reduce((a, b) => a + b, 0) / node.baselineSamples.length;
        node.baselineLocked = true;
      } else if (node.baselineSamples.length > 0) {
        node.baselineRate = ratePerMin;
      }
    }

    const baseline = node.baselineRate || ratePerMin || 1;
    const silenceMs = now - node.lastTickAt;
    const rateDrop = baseline > 0 ? (baseline - ratePerMin) / baseline : 0;

    const prevState = node.state;
    let nextState: NodeState = prevState;

    switch (prevState) {
      case 'normal':
        if (node.id === 'chart' ? rafLag > DEGRADED_RAF_LAG_MS : rateDrop > DEGRADED_RATE_DROP || rafLag > DEGRADED_RAF_LAG_MS)
          nextState = 'degraded';
        break;
      case 'degraded':
        if (silenceMs > FROZEN_SILENCE_MS && node.id !== 'chart')
          nextState = 'frozen';
        else if (node.id === 'chart' ? rafLag <= DEGRADED_RAF_LAG_MS : rateDrop <= DEGRADED_RATE_DROP * 0.5)
          nextState = 'normal';
        break;
      case 'frozen':
        if (node.id !== 'chart' && silenceMs < FROZEN_SILENCE_MS * 0.5)
          nextState = 'normal';
        break;
    }

    node.state = nextState;
    node.ticksInWindow = node.tickTimestamps.length;

    if (nextState !== prevState) {
      this.onStateTransition(node, prevState, nextState, now, ratePerMin, rafLag);
    }
  }

  private onStateTransition(
    node: NodeCounters,
    from: NodeState,
    to: NodeState,
    now: number,
    ratePerMin: number,
    rafLag: number,
  ) {
    const key = node.id;

    if (to === 'degraded' || to === 'frozen') {
      const type = to === 'frozen' ? 'freeze' : 'lag';
      if (!this.openIncidents.has(key)) {
        const incident: Incident = {
          id: `${key}-${now}`,
          type,
          nodeId: key,
          startTime: now,
          endTime: null,
          trigger: to === 'frozen'
            ? `No tick for ${(FROZEN_SILENCE_MS / 1000).toFixed(0)}s`
            : node.id === 'chart'
              ? `RAF lag ${rafLag.toFixed(0)}ms`
              : `Tick rate ${ratePerMin.toFixed(0)}/min (dropped from ${node.baselineRate.toFixed(0)}/min)`,
          worstLagMs: rafLag,
          priceOffset: this.priceByteOffset,
        };
        this.openIncidents.set(key, incident);
        this.incidents.push(incident);
      } else if (to === 'frozen') {
        const existing = this.openIncidents.get(key)!;
        existing.type = 'freeze';
      }
    } else if (to === 'normal') {
      const open = this.openIncidents.get(key);
      if (open) {
        open.endTime = now;
        this.openIncidents.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot rebuild
  // ---------------------------------------------------------------------------

  private rebuildSnapshot(now: number, marketOpen: boolean) {
    const nodes: NodeMetrics[] = Object.values(this.nodes).map((n) => {
      const windowMs = Math.min(WINDOW_MS, now - this.sessionStartTime + 1);
      const rate = n.id === 'chart'
        ? (n.rafFrameTimes.length / (WINDOW_MS / 1000)) * 60
        : (n.tickTimestamps.length / (windowMs / 1000)) * 60;
      const avgRaf = n.id === 'chart' && n.rafFrameTimes.length
        ? n.rafFrameTimes.reduce((a, b) => a + b, 0) / n.rafFrameTimes.length
        : 0;

      const subRates = n.subEventTimestamps
        ? Object.entries(n.subEventTimestamps).map(([label, ts]) => ({
            label,
            rate: Math.round((ts.length / (windowMs / 1000)) * 60),
          }))
        : undefined;

      return {
        id: n.id,
        label: n.label,
        state: n.state,
        lastTickAgo: n.lastTickAt > 0 ? now - n.lastTickAt : 0,
        tickRate: Math.round(rate),
        baselineRate: Math.round(n.baselineRate),
        rafLagMs: Math.round(avgRaf),
        latencyMs: 0,
        hubRttMs: n.id === 'market-hub' ? this.hubRttMs : n.id === 'user-hub' ? this.userHubRttMs : 0,
        hubState: n.hubState,
        subRates,
      };
    });

    const allStreamingNodes = nodes.filter((n) => n.id !== 'api');
    const worstState: NodeState = allStreamingNodes.some((n) => n.state === 'frozen')
      ? 'frozen'
      : allStreamingNodes.some((n) => n.state === 'degraded')
        ? 'degraded'
        : 'normal';

    const apiCategories = this.buildApiCategories(now);

    this.snapshot = {
      nodes,
      incidents: this.incidents,
      apiCategories,
      worstState: marketOpen ? worstState : 'normal',
      sessionStartTime: this.sessionStartTime,
      marketOpen,
    };
  }

  private buildApiCategories(now: number): ApiCategoryMetrics[] {
    // Group endpoints by category
    const groups = new Map<string, EndpointRecord[]>();
    for (const ep of this.endpointRecords.values()) {
      const cat = categoryFor(ep.path);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(ep);
    }

    const result: ApiCategoryMetrics[] = [];
    for (const [name, eps] of groups) {
      const endpoints: ApiEndpointMetrics[] = eps.map((ep) => {
        const sorted = [...ep.latencies].sort((a, b) => a - b);
        const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
        const p95 = sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]) : 0;
        return {
          method: ep.method,
          path: ep.path,
          callCount: ep.callCount,
          avgLatencyMs: avg,
          p95LatencyMs: p95,
          lastLatencyMs: ep.lastLatencyMs,
          lastCallAgo: ep.lastCallAt > 0 ? now - ep.lastCallAt : 0,
          lastOk: ep.lastOk,
        };
      });

      const totalCalls = endpoints.reduce((s, e) => s + e.callCount, 0);
      const allLatencies = eps.flatMap((e) => e.latencies);
      const avgLatencyMs = allLatencies.length
        ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
        : 0;
      const lastEndpoint = eps.reduce((a, b) => (a.lastCallAt > b.lastCallAt ? a : b));
      const lastCallAgo = lastEndpoint.lastCallAt > 0 ? now - lastEndpoint.lastCallAt : 0;
      const lastOk = eps.every((e) => e.lastOk);

      result.push({ name, endpoints, totalCalls, avgLatencyMs, lastCallAgo, lastOk });
    }

    // Sort: Market Data first, then alphabetical
    const ORDER = ['Market Data', 'Orders', 'Auth', 'Data Sync', 'Settings', 'Other'];
    result.sort((a, b) => {
      const ai = ORDER.indexOf(a.name);
      const bi = ORDER.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    return result;
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}

export const metricCollector = new MetricCollector();
