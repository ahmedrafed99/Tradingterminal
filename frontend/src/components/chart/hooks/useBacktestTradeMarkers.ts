import { useEffect } from 'react';
import type { ChartRefs } from './types';
import { useStore } from '../../../store/useStore';
import type { TradeZone } from '../TradeZonePrimitive';
import type { Trade } from '../../../services/tradeService';
import type { BacktestTrade } from '../../../services/backtestService';
import { OrderSide } from '../../../types/enums';

function toZone(trade: BacktestTrade): TradeZone {
  const isLong = trade.side === 'long';
  return {
    entryTrade: {
      creationTimestamp: trade.entryTime,
      price: trade.entryPrice,
      side: isLong ? OrderSide.Buy : OrderSide.Sell,
      size: trade.qty,
    } as Trade,
    exitTrade: {
      creationTimestamp: trade.exitTime,
      price: trade.exitPrice,
      side: isLong ? OrderSide.Sell : OrderSide.Buy,
      size: trade.qty,
    } as Trade,
    profitable: trade.pnl > 0,
  };
}

export function useBacktestTradeMarkers(refs: ChartRefs, chartId: string): void {
  useEffect(() => {
    if (chartId !== 'backtest') return;

    function rebuild() {
      const primitive = refs.tradeZonePrimitive.current;
      if (!primitive) return;

      const { backtestResult, backtestSelectedTradeIndex } = useStore.getState();

      if (!backtestResult || backtestSelectedTradeIndex === null) {
        primitive.setData([]);
        return;
      }

      const trade = backtestResult.trades[backtestSelectedTradeIndex];
      if (!trade) { primitive.setData([]); return; }

      primitive.setData([toZone(trade)]);
    }

    rebuild();

    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.backtestSelectedTradeIndex !== prev.backtestSelectedTradeIndex ||
        s.backtestResult !== prev.backtestResult
      ) {
        rebuild();
      }
    });

    return () => {
      unsub();
      refs.tradeZonePrimitive.current?.setData([]);
    };
  }, [chartId]);
}
