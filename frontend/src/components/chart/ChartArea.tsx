import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { CandlestickChart } from './CandlestickChart';
import type { CandlestickChartHandle } from './CandlestickChart';
import { DrawingToolbar } from './DrawingToolbar';
import { marketDataService } from '../../services/marketDataService';
import type { MouseEventParams } from 'lightweight-charts';

export function ChartArea() {
  const contract = useStore((s) => s.contract);
  const timeframe = useStore((s) => s.timeframe);
  const dualChart = useStore((s) => s.dualChart);
  const secondContract = useStore((s) => s.secondContract);
  const secondTimeframe = useStore((s) => s.secondTimeframe);
  const selectedChart = useStore((s) => s.selectedChart);
  const splitRatio = useStore((s) => s.splitRatio);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const setSecondContract = useStore((s) => s.setSecondContract);

  const leftRef = useRef<CandlestickChartHandle>(null);
  const rightRef = useRef<CandlestickChartHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Defer right chart mount by one frame so flex layout settles first.
  // Without this, the right chart's createChart() fires before the left panel
  // has shrunk, causing a brief overflow glitch on the second toggle cycle.
  const [rightChartReady, setRightChartReady] = useState(false);

  useEffect(() => {
    if (dualChart) {
      const id = requestAnimationFrame(() => setRightChartReady(true));
      return () => { cancelAnimationFrame(id); setRightChartReady(false); };
    }
    setRightChartReady(false);
  }, [dualChart]);

  // -- MNQ auto-load when dual mode is enabled --
  useEffect(() => {
    if (!dualChart || secondContract) return;
    marketDataService
      .searchContracts('MNQ')
      .then((contracts) => {
        const active = contracts.find((c) => c.activeContract);
        if (active) setSecondContract(active);
      })
      .catch(() => {});
  }, [dualChart, secondContract, setSecondContract]);

  // -- Crosshair sync between charts --
  // Uses rAF retry to wait for both chart APIs, avoiding timing races with
  // the deferred right-chart mount and child effect ordering.
  useEffect(() => {
    if (!dualChart) return;

    let cancelled = false;
    let retryId = 0;
    let unsub: (() => void) | null = null;

    function trySubscribe() {
      if (cancelled) return;

      const leftChart = leftRef.current?.getChartApi();
      const rightChart = rightRef.current?.getChartApi();
      const leftSeries = leftRef.current?.getSeriesApi();
      const rightSeries = rightRef.current?.getSeriesApi();

      if (!leftChart || !rightChart || !leftSeries || !rightSeries) {
        retryId = requestAnimationFrame(trySubscribe);
        return;
      }

      let rightClearTimer: ReturnType<typeof setTimeout> | null = null;
      let leftClearTimer: ReturnType<typeof setTimeout> | null = null;
      // Flags to prevent infinite sync loops (A→B→A) while still allowing
      // programmatic crosshair moves (e.g. QO drag) to sync to the peer chart.
      let syncingToRight = false;
      let syncingToLeft = false;

      const onLeftMove = (param: MouseEventParams) => {
        if (syncingToLeft) return;
        if (!param.time || !param.point) {
          if (rightClearTimer) clearTimeout(rightClearTimer);
          rightClearTimer = setTimeout(() => {
            if (!leftRef.current?.isQoHovered()) {
              syncingToRight = true;
              rightChart.clearCrosshairPosition();
              syncingToRight = false;
              rightRef.current?.setCrosshairPrice(null);
            }
          }, 16);
          return;
        }
        if (rightClearTimer) { clearTimeout(rightClearTimer); rightClearTimer = null; }
        const sourcePrice = leftSeries.coordinateToPrice(param.point.y);
        if (sourcePrice != null) {
          syncingToRight = true;
          rightChart.setCrosshairPosition(sourcePrice, param.time, rightSeries);
          syncingToRight = false;
          rightRef.current?.setCrosshairPrice(sourcePrice);
        } else {
          syncingToRight = true;
          rightChart.clearCrosshairPosition();
          syncingToRight = false;
          rightRef.current?.setCrosshairPrice(null);
        }
      };

      const onRightMove = (param: MouseEventParams) => {
        if (syncingToRight) return;
        if (!param.time || !param.point) {
          if (leftClearTimer) clearTimeout(leftClearTimer);
          leftClearTimer = setTimeout(() => {
            if (!rightRef.current?.isQoHovered()) {
              syncingToLeft = true;
              leftChart.clearCrosshairPosition();
              syncingToLeft = false;
              leftRef.current?.setCrosshairPrice(null);
            }
          }, 16);
          return;
        }
        if (leftClearTimer) { clearTimeout(leftClearTimer); leftClearTimer = null; }
        const sourcePrice = rightSeries.coordinateToPrice(param.point.y);
        if (sourcePrice != null) {
          syncingToLeft = true;
          leftChart.setCrosshairPosition(sourcePrice, param.time, leftSeries);
          syncingToLeft = false;
          leftRef.current?.setCrosshairPrice(sourcePrice);
        } else {
          syncingToLeft = true;
          leftChart.clearCrosshairPosition();
          syncingToLeft = false;
          leftRef.current?.setCrosshairPrice(null);
        }
      };

      leftChart.subscribeCrosshairMove(onLeftMove);
      rightChart.subscribeCrosshairMove(onRightMove);

      // Expose direct peer-sync callbacks so QO drag can bypass the async
      // crosshair callback chain (eliminates 1–2 frame lag).
      leftRef.current?.setPeerSync((price, time) => {
        syncingToRight = true;
        rightChart.setCrosshairPosition(price, time as Parameters<typeof rightChart.setCrosshairPosition>[1], rightSeries);
        syncingToRight = false;
        rightRef.current?.setCrosshairPrice(price);
      });
      rightRef.current?.setPeerSync((price, time) => {
        syncingToLeft = true;
        leftChart.setCrosshairPosition(price, time as Parameters<typeof leftChart.setCrosshairPosition>[1], leftSeries);
        syncingToLeft = false;
        leftRef.current?.setCrosshairPrice(price);
      });

      unsub = () => {
        if (rightClearTimer) clearTimeout(rightClearTimer);
        if (leftClearTimer) clearTimeout(leftClearTimer);
        leftChart.unsubscribeCrosshairMove(onLeftMove);
        rightChart.unsubscribeCrosshairMove(onRightMove);
        leftRef.current?.setPeerSync(null);
        rightRef.current?.setPeerSync(null);
      };
    }

    trySubscribe();

    return () => {
      cancelled = true;
      cancelAnimationFrame(retryId);
      unsub?.();
    };
  }, [dualChart, contract, secondContract]);

  // Selection border class
  const selectedBorder = useCallback(
    (side: 'left' | 'right') =>
      dualChart && selectedChart === side
        ? 'ring-1 ring-[#2962ff] ring-inset'
        : '',
    [dualChart, selectedChart],
  );

  return (
    <div ref={containerRef} className="flex-1 flex flex-row min-h-0 overflow-hidden relative">
      <DrawingToolbar />
      {/* Left chart panel */}
      <div
        style={{ flex: dualChart ? splitRatio : 1 }}
        className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${selectedBorder('left')}`}
      >
        {contract ? (
          <CandlestickChart
            ref={leftRef}
            chartId="left"
            contract={contract}
            timeframe={timeframe}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[#434651] text-sm">Select an instrument to get started</p>
          </div>
        )}
      </div>

      {/* Separator */}
      {dualChart && (
        <DraggableSeparator
          containerRef={containerRef}
          splitRatio={splitRatio}
          setSplitRatio={setSplitRatio}
        />
      )}

      {/* Right chart panel */}
      {dualChart && (
        <div
          style={{ flex: 1 - splitRatio }}
          className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${selectedBorder('right')}`}
        >
          {rightChartReady && secondContract ? (
            <CandlestickChart
              ref={rightRef}
              chartId="right"
              contract={secondContract}
              timeframe={secondTimeframe}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[#434651] text-sm">{secondContract ? '' : 'Loading MNQ...'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable Separator
// ---------------------------------------------------------------------------
function DraggableSeparator({
  containerRef,
  splitRatio,
  setSplitRatio,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  splitRatio: number;
  setSplitRatio: (ratio: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;

    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(ratio);
    }

    function onMouseUp() {
      setDragging(false);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, containerRef, setSplitRatio]);

  return (
    <div
      className={`w-1 cursor-col-resize flex-shrink-0 transition-colors ${
        dragging ? 'bg-[#2962ff]' : 'bg-black hover:bg-[#434651]'
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
    />
  );
}
