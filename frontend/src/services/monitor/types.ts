export type NodeId = 'market-hub' | 'user-hub' | 'adapter' | 'chart' | 'api';
export type ConsoleTab = 'market-hub' | 'user-hub' | 'api';

export interface ConsoleEntry {
  id: number;
  ts: number;
  tab: ConsoleTab;
  kind: string;
  text: string;
  ok?: boolean;
}
export type HubConnectionState = 'connected' | 'reconnecting' | 'disconnected';
export type NodeState = 'normal' | 'degraded' | 'frozen';

export interface NodeMetrics {
  id: NodeId;
  label: string;
  state: NodeState;
  lastTickAgo: number;   // ms since last tick (or frame for chart)
  tickRate: number;      // ticks or frames per minute, current window
  baselineRate: number;  // established baseline ticks/frames per minute
  rafLagMs: number;      // only meaningful for 'chart' node; 0 otherwise
  latencyMs: number;     // only meaningful for 'api' node; 0 otherwise
  hubRttMs: number;      // WebSocket RTT from periodic ping; 0 if not a hub or not connected
  hubState?: HubConnectionState;            // market-hub and user-hub only
  subRates?: { label: string; rate: number }[]; // per-event breakdown
}

export interface ApiEndpointMetrics {
  method: string;
  path: string;
  callCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastLatencyMs: number; // latency of the most recent call
  lastCallAgo: number;   // ms since last call; 0 if never called
  lastOk: boolean;
}

export interface ApiCategoryMetrics {
  name: string;
  endpoints: ApiEndpointMetrics[];
  totalCalls: number;
  avgLatencyMs: number;
  lastCallAgo: number;
  lastOk: boolean;
}

export interface Incident {
  id: string;
  type: 'lag' | 'freeze';
  nodeId: NodeId;
  startTime: number;     // performance.now()
  endTime: number | null;
  trigger: string;       // human-readable description
  worstLagMs: number;
  priceOffset: number;   // byte offset into prices_*.bin at incident start
}

export interface MonitorSnapshot {
  nodes: NodeMetrics[];
  incidents: Incident[];
  apiCategories: ApiCategoryMetrics[];
  worstState: NodeState;
  sessionStartTime: number;
  marketOpen: boolean;
}

export interface SessionSummary {
  date: string;
  symbol: string;
  contract: string;
  startTime: number;
  endTime: number;
  tickCount: number;
  incidentCount: number;
  serverGaps: number;
  appLags: number;
  uptimePct: number;
  verdict: string;
}
