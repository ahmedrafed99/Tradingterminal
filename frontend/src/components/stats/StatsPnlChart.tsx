import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { TradeStats, DayPnl } from '../../utils/tradeStats';
import { COLOR_BUY, COLOR_SELL, COLOR_POPOVER, COLOR_TEXT_MUTED } from '../../constants/colors';
import { niceStep } from './statsHelpers';
import { drawEquityCurve, precomputeTimeLabels } from './EquityCurveCanvas';
import type { EquityCurveConfig } from './EquityCurveCanvas';

type Mode = 'equity' | 'daily';

const CHART_HEIGHT = 240;
const PAD = { top: 24, right: 24, bottom: 36, left: 64 };

const EQUITY_CONFIG: EquityCurveConfig = {
  height: CHART_HEIGHT,
  pad: PAD,
  dotThreshold: 30,
  dotRadius: 3,
  gridTargetLines: 4,
};

interface HoverInfo {
  x: number;
  y: number;
  label: string;
  value: string;
  sub?: string;
  color: string;
}

type HitPoint = HoverInfo;

export function StatsPnlChart({ stats, dailyData, exitTimes = [], singleDay = false, onDayClick }: { stats: TradeStats; dailyData: DayPnl[]; exitTimes?: string[]; singleDay?: boolean; onDayClick?: (date: string) => void }) {
  const [modeChoice, setModeChoice] = useState<Mode>('equity');
  const mode: Mode = singleDay ? 'equity' : modeChoice;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Pre-compute time labels once (not per animation frame)
  const timeLabels = useMemo(() => precomputeTimeLabels(exitTimes), [exitTimes]);

  // Store computed positions for hit testing
  const pointsRef = useRef<HitPoint[]>([]);
  const hoveredBarRef = useRef<number>(-1);
  const rectRef = useRef<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.clientWidth);
    }
    if (overlayRef.current) {
      rectRef.current = overlayRef.current.getBoundingClientRect();
    }
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    // Update cached rect on scroll so hit-testing stays accurate
    const onScroll = () => {
      if (overlayRef.current) rectRef.current = overlayRef.current.getBoundingClientRect();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', onScroll, true); };
  }, [measure]);

  const animRef = useRef(0);
  const dataKeyRef = useRef('');

  // Draw helper — reusable for both animated and static draws
  const draw = useCallback((progress = 1) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    const points: typeof pointsRef.current = [];
    if (mode === 'equity') {
      drawEquityCurve(ctx, width, stats.equityCurve, points, EQUITY_CONFIG, timeLabels, progress);
    } else {
      drawDailyBars(ctx, width, dailyData, points, progress, hoveredBarRef.current);
    }
    pointsRef.current = points;
    ctx.restore();
  }, [width, mode, stats, dailyData, timeLabels]);

  // Animate only when data or mode actually changes — not on resize
  useEffect(() => {
    const key = `${mode}:${stats.totalTrades}:${stats.netPnl}:${dailyData.length}`;
    if (dataKeyRef.current === key) {
      // Data unchanged (e.g. width changed) — just redraw without animation
      draw(1);
      return;
    }
    dataKeyRef.current = key;

    cancelAnimationFrame(animRef.current);
    const startTime = performance.now();
    const duration = 700;
    const frame = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const progress = 1 - Math.pow(1 - t, 3);
      draw(progress);
      if (t < 1) animRef.current = requestAnimationFrame(frame);
    };
    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // Redraw base canvas (no animation) to reflect hovered bar change
  const redrawBase = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'daily') return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    const points: typeof pointsRef.current = [];
    drawDailyBars(ctx, width, dailyData, points, 1, hoveredBarRef.current);
    pointsRef.current = points;
    ctx.restore();
  }, [width, mode, dailyData]);

  // Keep overlay sized to match base canvas
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dpr = window.devicePixelRatio || 1;
    overlay.width = width * dpr;
    overlay.height = CHART_HEIGHT * dpr;
  }, [width]);

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    ctx.restore();
  }, [width]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!rectRef.current) rectRef.current = overlay.getBoundingClientRect();
    const rect = rectRef.current;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find closest point
    let closest: typeof pointsRef.current[0] | null = null;
    let minDist = Infinity;

    for (const p of pointsRef.current) {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);

    // Find hovered index for daily bar highlight
    const closestIdx = closest ? pointsRef.current.indexOf(closest) : -1;

    if (closest && minDist < 60) {
      setHover({ ...closest });

      if (mode === 'daily') {
        // Redraw base canvas with highlighted bar
        if (hoveredBarRef.current !== closestIdx) {
          hoveredBarRef.current = closestIdx;
          redrawBase();
        }
      } else {
        // Vertical crosshair line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(closest.x, PAD.top);
        ctx.lineTo(closest.x, CHART_HEIGHT - PAD.bottom);
        ctx.stroke();

        // Horizontal crosshair line
        ctx.beginPath();
        ctx.moveTo(PAD.left, closest.y);
        ctx.lineTo(width - PAD.right, closest.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Highlight dot
        ctx.beginPath();
        ctx.arc(closest.x, closest.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_POPOVER;
        ctx.fill();
        ctx.strokeStyle = closest.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Time label on X axis
        if (closest.sub) {
          const labelY = CHART_HEIGHT - 10;
          const metrics = ctx.measureText(closest.sub);
          const pad = 4;
          ctx.fillStyle = COLOR_POPOVER;
          ctx.fillRect(closest.x - metrics.width / 2 - pad, labelY - 10, metrics.width + pad * 2, 14);
          ctx.fillStyle = '#fff';
          ctx.font = FONT;
          ctx.textAlign = 'center';
          ctx.fillText(closest.sub, closest.x, labelY);
        }
      }
    } else {
      setHover(null);
      if (mode === 'daily' && hoveredBarRef.current !== -1) {
        hoveredBarRef.current = -1;
        redrawBase();
      }
    }

    ctx.restore();
  }, [mode, width, redrawBase]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    clearOverlay();
    if (hoveredBarRef.current !== -1) {
      hoveredBarRef.current = -1;
      redrawBase();
    }
  }, [clearOverlay, redrawBase]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'daily' || !onDayClick) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!rectRef.current) rectRef.current = overlay.getBoundingClientRect();
    const mx = e.clientX - rectRef.current.left;

    let closest: typeof pointsRef.current[0] | null = null;
    let minDist = Infinity;
    for (const p of pointsRef.current) {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist) { minDist = dist; closest = p; }
    }

    if (closest && minDist < 60) {
      onDayClick(closest.label);
    }
  }, [mode, onDayClick]);

  return (
    <div
      style={{
        background: 'var(--color-table-stripe)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '20px 24px',
        position: 'relative',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 16, position: 'relative' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.02em' }}>
          {mode === 'equity' ? 'Equity Curve' : 'Daily P&L'}
        </div>
        {/* Hover tooltip — centered in header, fixed-width segments */}
        {hover && (
          <div
            className="flex items-center justify-center"
            style={{ position: 'absolute', left: 0, right: 0, pointerEvents: 'none', fontSize: 13 }}
          >
            <span style={{ flex: '0 0 110px', textAlign: 'center', fontWeight: 600, color: hover.color, fontFeatureSettings: '"tnum"' }}>{hover.value}</span>
            {mode === 'daily' && hover.sub && (
              <span style={{ flex: '0 0 90px', textAlign: 'left', color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>{hover.sub}</span>
            )}
          </div>
        )}
        {!singleDay && <div
          className="flex"
          style={{
            background: 'var(--color-surface)',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setModeChoice('equity')}
            className="cursor-pointer transition-colors"
            style={{
              fontSize: 12,
              padding: '5px 12px',
              background: mode === 'equity' ? 'var(--color-hover-row)' : 'transparent',
              color: mode === 'equity' ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
              border: 'none',
              borderRight: '1px solid var(--color-border)',
            }}
          >
            Equity
          </button>
          <button
            onClick={() => setModeChoice('daily')}
            className="cursor-pointer transition-colors"
            style={{
              fontSize: 12,
              padding: '5px 12px',
              background: mode === 'daily' ? 'var(--color-hover-row)' : 'transparent',
              color: mode === 'daily' ? 'var(--color-text-bright)' : 'var(--color-text-muted)',
              border: 'none',
            }}
          >
            Daily
          </button>
        </div>}
      </div>

      <div ref={containerRef} style={{ borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }}
        />
        <canvas
          ref={overlayRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: CHART_HEIGHT, display: 'block', cursor: mode === 'daily' && onDayClick ? 'pointer' : 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />

      </div>
    </div>
  );
}

// ── Canvas renderers ─────────────────────────────────────────────────────────

const TEXT_COLOR = COLOR_TEXT_MUTED;
const FONT = '13px -apple-system, BlinkMacSystemFont, sans-serif';

function drawDailyBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  data: DayPnl[],
  hitPoints: HitPoint[],
  progress = 1,
  hoveredIdx = -1,
) {
  if (data.length === 0) {
    drawEmpty(ctx, w, 'No daily data');
    return;
  }

  const plotW = w - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const vals = data.map((d) => d.net);
  const minY = Math.min(0, ...vals);
  const maxY = Math.max(0, ...vals);
  const rangeY = maxY - minY || 1;

  const barW = Math.min(48, Math.max(8, (plotW / data.length) * 0.65));
  const totalBarSpace = barW * data.length;
  const totalGapSpace = plotW - totalBarSpace;
  const gap = totalGapSpace / (data.length + 1);

  const toY = (v: number) => PAD.top + plotH - ((v - minY) / rangeY) * plotH;
  const zeroY = toY(0);

  drawHorizontalGrid(ctx, w, minY, maxY, toY);

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD.left, zeroY);
  ctx.lineTo(w - PAD.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bars + hit targets (scale height by progress for animation)
  for (let i = 0; i < data.length; i++) {
    const x = PAD.left + gap + i * (barW + gap);
    const animNet = data[i].net * progress;
    const y = toY(animNet);
    const h = Math.abs(y - zeroY);
    const top = animNet >= 0 ? y : zeroY;
    const barColor = data[i].net >= 0 ? COLOR_BUY : COLOR_SELL;
    const isHovered = hoveredIdx === i;
    const dimmed = hoveredIdx >= 0 && !isHovered;

    // Full-height column highlight behind hovered bar
    if (isHovered) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x - gap / 2, PAD.top, barW + gap, plotH);
    }

    ctx.globalAlpha = dimmed ? 0.35 : 1.0;
    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(x, top, barW, Math.max(1, h), 3);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    const sign = data[i].net > 0 ? '+' : data[i].net < 0 ? '-' : '';
    hitPoints.push({
      x: x + barW / 2,
      y: toY(data[i].net),
      label: data[i].date,
      value: `${sign}$${Math.abs(data[i].net).toFixed(2)}`,
      sub: `${data[i].tradeCount} ${data[i].tradeCount === 1 ? 'trade' : 'trades'}`,
      color: barColor,
    });
  }

  // X labels
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = FONT;
  ctx.textAlign = 'center';
  for (let i = 0; i < data.length; i++) {
    const x = PAD.left + gap + i * (barW + gap) + barW / 2;
    ctx.fillText(data[i].date.slice(5), x, CHART_HEIGHT - 10);
  }
}

function drawHorizontalGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  minY: number,
  maxY: number,
  toY: (v: number) => number,
) {
  const range = maxY - minY || 1;
  const step = niceStep(range, 4);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = FONT;
  ctx.textAlign = 'right';

  const start = Math.ceil(minY / step) * step;
  for (let v = start; v <= maxY; v += step) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(w - PAD.right, y);
    ctx.stroke();
    ctx.fillText(`${v.toFixed(0)}$`, PAD.left - 8, y + 3);
  }
}

function drawEmpty(ctx: CanvasRenderingContext2D, w: number, text: string) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, CHART_HEIGHT / 2);
}
