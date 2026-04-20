import { realtimeService } from '../realtimeService';
import type { Quote, RealtimeOrder, RealtimeTrade, RealtimePosition, DepthEntry } from '../../adapters/types';
import { DepthType } from '../../types/enums';
import type { ConsoleEntry, ConsoleTab } from './types';

const MAX = 200;
let nextId = 0;

const buffers: Record<ConsoleTab, ConsoleEntry[]> = {
  'market-hub': [],
  'user-hub': [],
  'api': [],
};

const listeners = new Set<() => void>();

function push(tab: ConsoleTab, kind: string, text: string, ok?: boolean) {
  const buf = [...buffers[tab], { id: nextId++, ts: Date.now(), tab, kind, text, ok }];
  if (buf.length > MAX) buf.shift();
  buffers[tab] = buf;
  listeners.forEach(fn => fn());
}

// Quote throttle: max 10/s
let lastQuoteTs = 0;
// Depth throttle: max 5/s
let lastDepthTs = 0;

const ACTION: Record<number, string> = { 0: 'created', 1: 'updated', 2: 'deleted' };
function act(n: number) { return ACTION[n] ?? `action:${n}`; }

export const consoleBuffer = {
  getEntries(tab: ConsoleTab): ConsoleEntry[] {
    return buffers[tab];
  },

  clear(tab?: ConsoleTab) {
    if (tab) {
      buffers[tab] = [];
    } else {
      (Object.keys(buffers) as ConsoleTab[]).forEach(t => { buffers[t] = []; });
    }
    listeners.forEach(fn => fn());
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  pushApi(method: string, path: string, latencyMs: number, ok: boolean) {
    push('api', method, `${path}  ${latencyMs.toFixed(0)}ms  ${ok ? 'OK' : 'ERR'}`, ok);
  },

  start(): () => void {
    const onQuote = (_cid: string, q: Quote) => {
      const now = Date.now();
      if (now - lastQuoteTs < 100) return;
      lastQuoteTs = now;
      push('market-hub', 'QUOTE', `${q.symbolName || q.symbol}  ${q.lastPrice}  bid:${q.bestBid}  ask:${q.bestAsk}`);
    };

    const onTrade = (t: RealtimeTrade, action: number) => {
      push('market-hub', 'TRADE', `${t.contractId}  ${t.price}  ×${t.size}  ${t.side}  ${act(action)}`);
    };

    const onDepth = (_cid: string, entries: DepthEntry[]) => {
      const now = Date.now();
      if (now - lastDepthTs < 200) return;
      lastDepthTs = now;
      const bestBid = entries.find(e => e.type === DepthType.BestBid);
      const bestAsk = entries.find(e => e.type === DepthType.BestAsk);
      push('market-hub', 'DEPTH', `${_cid}  bid:${bestBid?.price ?? '—'}×${bestBid?.volume ?? 0}  ask:${bestAsk?.price ?? '—'}×${bestAsk?.volume ?? 0}  (${entries.length} levels)`);
    };

    const onOrder = (o: RealtimeOrder, action: number) => {
      push('user-hub', 'ORDER', `${o.side} ×${o.size}  ${o.contractId}  ${o.status}  ${act(action)}`);
    };

    const onPosition = (p: RealtimePosition, action: number) => {
      push('user-hub', 'POS', `${p.contractId}  ×${p.size}  @${p.averagePrice}  ${act(action)}`);
    };

    const onMarketState = (state: string) => {
      push('market-hub', 'STATE', state);
    };

    const onUserState = (state: string) => {
      push('user-hub', 'STATE', state);
    };

    realtimeService.onQuote(onQuote);
    realtimeService.onTrade(onTrade);
    realtimeService.onDepth(onDepth);
    realtimeService.onOrder(onOrder);
    realtimeService.onPosition(onPosition);
    realtimeService.onMarketHubState(onMarketState);
    realtimeService.onUserHubState(onUserState);

    return () => {
      realtimeService.offQuote(onQuote);
      realtimeService.offTrade(onTrade);
      realtimeService.offDepth(onDepth);
      realtimeService.offOrder(onOrder);
      realtimeService.offPosition(onPosition);
      realtimeService.offMarketHubState(onMarketState);
      realtimeService.offUserHubState(onUserState);
    };
  },
};
