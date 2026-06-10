import { useEffect, useRef, useState } from 'react';
import type { Contract } from '../../../services/marketDataService';
import type { Timeframe } from '../../../store/useStore';
import { useStore } from '../../../store/useStore';
import { realtimeService } from '../../../services/realtimeService';
import type { ChartRefs } from './types';
import type { BacktestConfig } from '../CandlestickChart';
import { useHistoricalBars } from './useHistoricalBars';
import { useRealtimeQuotes } from './useRealtimeQuotes';
import { useMarketDepth } from './useMarketDepth';
import { useChartInteraction } from './useChartInteraction';

export function useChartBars(
  refs: ChartRefs,
  chartId: 'left' | 'right' | 'backtest',
  contract: Contract | null,
  timeframe: Timeframe,
  backtestConfig?: BacktestConfig,
): { loading: boolean; error: string | null } {
  const connected = useStore((s) => s.connected);

  // Accumulated trade volume map for anchor-mode FRVP drawings (price → contracts traded).
  // Shared: written on historical load, updated per tick in realtime.
  const tradeAnchorMapRef = useRef(new Map<number, number>());

  // Tick bar live state: how many more ticks until the current bar closes.
  // Shared: initialised from partial bar on load, decremented per tick in realtime.
  const ticksRemainingRef = useRef<number>(0);

  // Bump to force historical bar reload on market hub reconnect
  const [reconnectCount, setReconnectCount] = useState(0);
  useEffect(() => {
    const handler = () => setReconnectCount((c) => c + 1);
    realtimeService.onMarketReconnect(handler);
    return () => { realtimeService.offMarketReconnect(handler); };
  }, []);

  const { loading, error } = useHistoricalBars(refs, chartId, contract, timeframe, backtestConfig, connected, reconnectCount, tradeAnchorMapRef, ticksRemainingRef);
  useRealtimeQuotes(refs, contract, timeframe, backtestConfig, connected, tradeAnchorMapRef, ticksRemainingRef);
  useMarketDepth(refs, contract, backtestConfig, connected, chartId);
  useChartInteraction(refs);

  return { loading, error };
}
