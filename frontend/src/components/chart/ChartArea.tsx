import { useEffect, useRef, useState, useCallback } from 'react';
import { Z } from '../../constants/layout';
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
  const [separatorDragging, setSeparatorDragging] = useState(false);

  const leftRef = useRef<CandlestickChartHandle>(null);
  const rightRef = useRef<CandlestickChartHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);


  // Defer right chart mount by one frame so flex layout settles first.
  // Without this, the right chart's createChart() fires before the left panel
  // has shrunk, causing a brief overflow glitch on the second toggle cycle.
  const [rightChartReady, setRightChartReady] = useState(false);

  useEffect(() => {
    if (dualChart && !rightChartReady) {
      const id = requestAnimationFrame(() => setRightChartReady(true));
      return () => cancelAnimationFrame(id);
    }
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
      .catch((err) => {
        console.error('[ChartArea] Auto-load MNQ failed:', err instanceof Error ? err.message : err);
      });
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
      // The chart currently driving the crosshair. While a master is set,
      // crosshair-move events from the *other* chart are ignored entirely,
      // preventing any async bounce-back from the library.
      let master: 'left' | 'right' | null = null;

      const onLeftMove = (param: MouseEventParams) => {
        if (master === 'right') return;
        master = 'left';
        if (!param.time || !param.point) {
          if (rightClearTimer) clearTimeout(rightClearTimer);
          rightClearTimer = setTimeout(() => {
            if (!leftRef.current?.isQoHovered()) {
              rightChart.clearCrosshairPosition();
              rightRef.current?.setCrosshairPrice(null);
            }
            master = null;
          }, 16);
          return;
        }
        if (rightClearTimer) { clearTimeout(rightClearTimer); rightClearTimer = null; }
        const sourcePrice = leftSeries.coordinateToPrice(param.point.y);
        if (sourcePrice != null) {
          // Clamp time to the right chart's visible range so the target chart
          // just sticks to its boundary when the source goes past it.
          const rightRange = rightChart.timeScale().getVisibleRange();
          let syncTime = param.time;
          if (rightRange) {
            const t = param.time as number;
            if (t < (rightRange.from as number)) syncTime = rightRange.from;
            else if (t > (rightRange.to as number)) syncTime = rightRange.to;
          }
          rightChart.setCrosshairPosition(sourcePrice, syncTime, rightSeries);
          rightRef.current?.setCrosshairPrice(sourcePrice);
        } else {
          rightChart.clearCrosshairPosition();
          rightRef.current?.setCrosshairPrice(null);
        }
      };

      const onRightMove = (param: MouseEventParams) => {
        if (master === 'left') return;
        master = 'right';
        if (!param.time || !param.point) {
          if (leftClearTimer) clearTimeout(leftClearTimer);
          leftClearTimer = setTimeout(() => {
            if (!rightRef.current?.isQoHovered()) {
              leftChart.clearCrosshairPosition();
              leftRef.current?.setCrosshairPrice(null);
            }
            master = null;
          }, 16);
          return;
        }
        if (leftClearTimer) { clearTimeout(leftClearTimer); leftClearTimer = null; }
        const sourcePrice = rightSeries.coordinateToPrice(param.point.y);
        if (sourcePrice != null) {
          const leftRange = leftChart.timeScale().getVisibleRange();
          let syncTime = param.time;
          if (leftRange) {
            const t = param.time as number;
            if (t < (leftRange.from as number)) syncTime = leftRange.from;
            else if (t > (leftRange.to as number)) syncTime = leftRange.to;
          }
          leftChart.setCrosshairPosition(sourcePrice, syncTime, leftSeries);
          leftRef.current?.setCrosshairPrice(sourcePrice);
        } else {
          leftChart.clearCrosshairPosition();
          leftRef.current?.setCrosshairPrice(null);
        }
      };

      leftChart.subscribeCrosshairMove(onLeftMove);
      rightChart.subscribeCrosshairMove(onRightMove);

      // Expose direct peer-sync callbacks so QO drag can bypass the async
      // crosshair callback chain (eliminates 1–2 frame lag).
      leftRef.current?.setPeerSync((price, time) => {
        master = 'left';
        rightChart.setCrosshairPosition(price, time as Parameters<typeof rightChart.setCrosshairPosition>[1], rightSeries);
        rightRef.current?.setCrosshairPrice(price);
      });
      rightRef.current?.setPeerSync((price, time) => {
        master = 'right';
        leftChart.setCrosshairPosition(price, time as Parameters<typeof leftChart.setCrosshairPosition>[1], leftSeries);
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

  // Selection border overlay
  const isSelected = useCallback(
    (side: 'left' | 'right') => dualChart && selectedChart === side,
    [dualChart, selectedChart],
  );

  const SelectionOverlay = ({ visible }: { visible: boolean }) => (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        zIndex: Z.DROPDOWN,
        border: '1px solid',
        borderColor: visible ? 'rgba(41, 98, 255, 0.5)' : 'transparent',
        transition: 'border-color var(--transition-slow) ease',
      }}
    />
  );

  return (
    <div ref={containerRef} className="flex-1 flex flex-row min-h-0 overflow-hidden relative">
      <DrawingToolbar />
      {/* Left chart panel */}
      <div
        style={{ flex: dualChart ? splitRatio : 1, pointerEvents: separatorDragging ? 'none' : undefined }}
        className="flex flex-col min-h-0 min-w-0 overflow-hidden relative"
      >
        {dualChart && <SelectionOverlay visible={isSelected('left')} />}
        {contract ? (
          <CandlestickChart
            ref={leftRef}
            chartId="left"
            contract={contract}
            timeframe={timeframe}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-(--color-text-dim) text-sm">Select an instrument to get started</p>
          </div>
        )}
      </div>

      {/* Separator */}
      {dualChart && (
        <DraggableSeparator
          containerRef={containerRef}
          splitRatio={splitRatio}
          setSplitRatio={setSplitRatio}
          onDragStart={() => setSeparatorDragging(true)}
          onDragEnd={() => setSeparatorDragging(false)}
        />
      )}

      {/* Right chart panel — always mounted to avoid remount cost on toggle */}
      <div
        style={{ flex: 1 - splitRatio, display: dualChart ? undefined : 'none', pointerEvents: separatorDragging ? 'none' : undefined }}
        className="flex flex-col min-h-0 min-w-0 overflow-hidden relative"
      >
        <SelectionOverlay visible={isSelected('right')} />
        {rightChartReady && secondContract ? (
          <CandlestickChart
            ref={rightRef}
            chartId="right"
            contract={secondContract}
            timeframe={secondTimeframe}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-(--color-text-dim) text-sm">{secondContract ? '' : 'Loading MNQ...'}</p>
          </div>
        )}
      </div>
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
  onDragStart,
  onDragEnd,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  splitRatio: number;
  setSplitRatio: (ratio: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (!dragging) return;

    let rafId = 0;

    function onMouseMove(e: MouseEvent) {
      const rect = rectRef.current;
      if (!rect) return;
      cancelAnimationFrame(rafId);
      const clientX = e.clientX;
      rafId = requestAnimationFrame(() => {
        const ratio = Math.min(0.9, Math.max(0.1, (clientX - rect.left) / rect.width));
        setSplitRatio(ratio);
      });
    }

    function onMouseUp() {
      cancelAnimationFrame(rafId);
      setDragging(false);
      onDragEnd();
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, setSplitRatio, onDragEnd]);

  return (
    <div
      className={`w-1 cursor-col-resize flex-shrink-0 transition-colors ${
        dragging ? 'bg-(--color-accent)' : 'bg-(--color-panel) hover:bg-(--color-text-dim)'
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
        rectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
        setDragging(true);
        onDragStart();
      }}
    />
  );
}
