import { useRef, useEffect, useState, useCallback } from 'react';
import type { TradeStats, DayPnl } from '../../utils/tradeStats';

type Mode = 'equity' | 'daily';

const CHART_HEIGHT = 240;
const PAD = { top: 24, right: 24, bottom: 36, left: 64 };

interface HoverInfo {
  x: number;
  y: number;
  label: string;
  value: string;
  sub?: string;
  color: string;
}

export function StatsPnlChart({ stats, dailyData }: { stats: TradeStats; dailyData: DayPnl[] }) {
  const [mode, setMode] = useState<Mode>('equity');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Store computed positions for hit testing
  const pointsRef = useRef<{ x: number; y: number; label: string; value: string; sub?: string; color: string }[]>([]);

  const measure = useCallback(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CHART_HEIGHT * dpr;

    cancelAnimationFrame(animRef.current);
    const startTime = performance.now();
    const duration = 700;

    const frame = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const progress = 1 - Math.pow(1 - t, 3);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, CHART_HEIGHT);

      const points: typeof pointsRef.current = [];

      if (mode === 'equity') {
        drawEquityCurve(ctx, width, stats.equityCurve, points, progress);
      } else {
        drawDailyBars(ctx, width, dailyData, points, progress);
      }

      pointsRef.current = points;
      ctx.restore();

      if (t < 1) animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [width, mode, stats, dailyData]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Find closest point
    let closest: typeof pointsRef.current[0] | null = null;
    let minDist = Infinity;

    for (const p of pointsRef.current) {
      const dist = mode === 'equity'
        ? Math.abs(p.x - mx) // For equity curve, snap to nearest x
        : Math.abs(p.x - mx) + Math.abs(p.y - my) * 0.3; // For bars, weight x more
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }

    if (closest && minDist < 60) {
      setHover({ ...closest });

      // Draw crosshair
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Redraw base chart
      ctx.clearRect(0, 0, width, CHART_HEIGHT);
      const pts: typeof pointsRef.current = [];
      if (mode === 'equity') {
        drawEquityCurve(ctx, width, stats.equityCurve, pts);
      } else {
        drawDailyBars(ctx, width, dailyData, pts);
      }

      // Vertical crosshair line
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(closest.x, PAD.top);
      ctx.lineTo(closest.x, CHART_HEIGHT - PAD.bottom);
      ctx.stroke();

      // Horizontal crosshair line (equity mode only)
      if (mode === 'equity') {
        ctx.beginPath();
        ctx.moveTo(PAD.left, closest.y);
        ctx.lineTo(width - PAD.right, closest.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Highlight dot
      ctx.beginPath();
      ctx.arc(closest.x, closest.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0a0f';
      ctx.fill();
      ctx.strokeStyle = closest.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    } else {
      if (hover) {
        setHover(null);
        // Redraw without crosshair
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, CHART_HEIGHT);
          const pts: typeof pointsRef.current = [];
          if (mode === 'equity') drawEquityCurve(ctx, width, stats.equityCurve, pts);
          else drawDailyBars(ctx, width, dailyData, pts);
          ctx.restore();
        }
      }
    }
  }, [mode, width, stats, dailyData, hover]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    const pts: typeof pointsRef.current = [];
    if (mode === 'equity') drawEquityCurve(ctx, width, stats.equityCurve, pts);
    else drawDailyBars(ctx, width, dailyData, pts);
    ctx.restore();
  }, [mode, width, stats, dailyData]);

  return (
    <div
      style={{
        background: '#0d1117',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '20px 24px',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.02em' }}>
          {mode === 'equity' ? 'Equity Curve' : 'Daily P&L'}
        </div>
        <div
          className="flex"
          style={{
            background: 'var(--color-surface)',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setMode('equity')}
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
            onClick={() => setMode('daily')}
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
        </div>
      </div>

      <div ref={containerRef} style={{ borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: CHART_HEIGHT, display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Floating tooltip */}
        {hover && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(hover.x + 12, width - 140),
              top: Math.max(hover.y - 50, 4),
              background: 'rgba(13, 17, 23, 0.95)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '8px 12px',
              pointerEvents: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              minWidth: 100,
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>
              {hover.label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: hover.color, fontFeatureSettings: '"tnum"' }}>
              {hover.value}
            </div>
            {hover.sub && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {hover.sub}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canvas renderers ─────────────────────────────────────────────────────────

const GREEN = '#26a69a';
const RED = '#ef5350';
const GRID_COLOR = 'rgba(42, 46, 57, 0.4)';
const TEXT_COLOR = '#787b86';
const FONT = '10px -apple-system, BlinkMacSystemFont, sans-serif';

function drawEquityCurve(
  ctx: CanvasRenderingContext2D,
  w: number,
  curve: number[],
  hitPoints: { x: number; y: number; label: string; value: string; sub?: string; color: string }[],
  progress = 1,
) {
  if (curve.length === 0) {
    drawEmpty(ctx, w, 'No trades');
    return;
  }

  // Animate: scale all values by progress (rise from zero line)
  const animCurve = curve.map((v) => v * progress);

  const plotW = w - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;

  const minY = Math.min(0, ...curve); // use full range for stable axis
  const maxY = Math.max(0, ...curve);
  const rangeY = maxY - minY || 1;

  const xStep = curve.length > 1 ? plotW / (curve.length - 1) : plotW / 2;
  const toX = (i: number) => PAD.left + i * xStep;
  const toY = (v: number) => PAD.top + plotH - ((v - minY) / rangeY) * plotH;

  drawHorizontalGrid(ctx, w, minY, maxY, toY);

  // Zero line
  const zeroY = toY(0);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD.left, zeroY);
  ctx.lineTo(w - PAD.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Area fills — separate green (above zero) and red (below zero)
  // Green area
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, zeroY - PAD.top);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < animCurve.length; i++) ctx.lineTo(toX(i), toY(animCurve[i]));
  ctx.lineTo(toX(animCurve.length - 1), zeroY);
  ctx.closePath();
  const greenGrad = ctx.createLinearGradient(0, PAD.top, 0, zeroY);
  greenGrad.addColorStop(0, 'rgba(38, 166, 154, 0.25)');
  greenGrad.addColorStop(1, 'rgba(38, 166, 154, 0.02)');
  ctx.fillStyle = greenGrad;
  ctx.fill();
  ctx.restore();

  // Red area
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, zeroY, plotW, CHART_HEIGHT - PAD.bottom - zeroY);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < animCurve.length; i++) ctx.lineTo(toX(i), toY(animCurve[i]));
  ctx.lineTo(toX(animCurve.length - 1), zeroY);
  ctx.closePath();
  const redGrad = ctx.createLinearGradient(0, zeroY, 0, CHART_HEIGHT - PAD.bottom);
  redGrad.addColorStop(0, 'rgba(239, 83, 80, 0.02)');
  redGrad.addColorStop(1, 'rgba(239, 83, 80, 0.25)');
  ctx.fillStyle = redGrad;
  ctx.fill();
  ctx.restore();

  // Line segments — green above zero, red below zero
  ctx.lineWidth = 1.5;
  for (let i = 1; i < animCurve.length; i++) {
    const prev = animCurve[i - 1];
    const curr = animCurve[i];

    if ((prev >= 0 && curr >= 0) || (prev < 0 && curr < 0)) {
      ctx.beginPath();
      ctx.moveTo(toX(i - 1), toY(prev));
      ctx.lineTo(toX(i), toY(curr));
      ctx.strokeStyle = curr >= 0 ? GREEN : RED;
      ctx.stroke();
    } else {
      const t = prev / (prev - curr);
      const crossX = toX(i - 1) + t * (toX(i) - toX(i - 1));
      ctx.beginPath();
      ctx.moveTo(toX(i - 1), toY(prev));
      ctx.lineTo(crossX, zeroY);
      ctx.strokeStyle = prev >= 0 ? GREEN : RED;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(crossX, zeroY);
      ctx.lineTo(toX(i), toY(curr));
      ctx.strokeStyle = curr >= 0 ? GREEN : RED;
      ctx.stroke();
    }
  }

  // Data points
  if (animCurve.length <= 30) {
    for (let i = 0; i < animCurve.length; i++) {
      ctx.beginPath();
      ctx.arc(toX(i), toY(animCurve[i]), 3, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117';
      ctx.fill();
      ctx.strokeStyle = animCurve[i] >= 0 ? GREEN : RED;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Build hit points for every data point
  const tradePnl: number[] = [];
  tradePnl.push(curve[0]);
  for (let i = 1; i < curve.length; i++) {
    tradePnl.push(curve[i] - curve[i - 1]);
  }

  for (let i = 0; i < curve.length; i++) {
    const sign = tradePnl[i] > 0 ? '+' : '';
    hitPoints.push({
      x: toX(i),
      y: toY(animCurve[i]),
      label: `Trade #${i + 1}`,
      value: `$${curve[i] > 0 ? '+' : ''}${curve[i].toFixed(2)}`,
      sub: `Trade P&L: ${sign}$${Math.abs(tradePnl[i]).toFixed(2)}`,
      color: curve[i] >= 0 ? GREEN : RED,
    });
  }

  // X axis — use nice round numbers
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = FONT;
  ctx.textAlign = 'center';
  const xNiceStep = niceStep(curve.length, 8);
  const xStart = Math.ceil(1 / xNiceStep) * xNiceStep || xNiceStep;
  for (let v = xStart; v <= curve.length; v += xNiceStep) {
    const i = v - 1;
    if (i >= 0 && i < curve.length) {
      ctx.fillText(String(v), toX(i), CHART_HEIGHT - 10);
    }
  }
  // Always show "1" at the start
  ctx.fillText('1', toX(0), CHART_HEIGHT - 10);
}

function drawDailyBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  data: DayPnl[],
  hitPoints: { x: number; y: number; label: string; value: string; sub?: string; color: string }[],
  progress = 1,
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
    const barColor = data[i].net >= 0 ? GREEN : RED;

    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(x, top, barW, Math.max(1, h), 3);
    ctx.fill();

    const sign = data[i].net > 0 ? '+' : '';
    hitPoints.push({
      x: x + barW / 2,
      y: data[i].net >= 0 ? toY(data[i].net) : toY(data[i].net) + Math.abs(toY(data[i].net) - zeroY),
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

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
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
    ctx.fillText(`$${v.toFixed(0)}`, PAD.left - 8, y + 3);
  }
}

function niceStep(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3.5) nice = 2;
  else if (norm <= 7.5) nice = 5;
  else nice = 10;
  return nice * mag || 1;
}

function drawEmpty(ctx: CanvasRenderingContext2D, w: number, text: string) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, CHART_HEIGHT / 2);
}
