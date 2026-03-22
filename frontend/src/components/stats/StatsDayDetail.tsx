import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { GroupedTrade } from '../../utils/tradeStats';
import { computeStats } from '../../utils/tradeStats';
import { formatDuration } from '../../utils/formatters';
import { COLOR_BUY, COLOR_SELL, COLOR_TABLE_STRIPE, COLOR_TEXT_MUTED, COLOR_BORDER } from '../../constants/colors';
import { pnlColor, fmtDollar, niceStep, hexToRgba } from './statsHelpers';

const CHART_HEIGHT = 160;
const PAD = { top: 16, right: 20, bottom: 28, left: 56 };
const GRID_COLOR = hexToRgba(COLOR_BORDER, 0.4);
const TEXT_COLOR = COLOR_TEXT_MUTED;

export function StatsDayDetail({ date, trades, onBack }: {
  date: string; // YYYY-MM-DD
  trades: GroupedTrade[];
  onBack: () => void;
}) {
  const stats = useMemo(() => computeStats(trades), [trades]);

  // Format date for display
  const displayDate = useMemo(() => {
    const d = new Date(date + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [date]);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Header with back button */}
      <div className="flex items-center" style={{ gap: 12 }}>
        <button
          onClick={onBack}
          className="cursor-pointer transition-colors text-(--color-text-muted) hover:text-(--color-text-bright)"
          style={{
            fontSize: 14,
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            borderRadius: 4,
          }}
        >
          ← Back
        </button>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-bright)' }}>
          {displayDate}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: pnlColor(stats.netPnl), fontFeatureSettings: '"tnum"', marginLeft: 8 }}>
          {fmtDollar(stats.netPnl)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
          {stats.totalTrades} {stats.totalTrades === 1 ? 'trade' : 'trades'} · {stats.winners}W / {stats.losers}L
        </div>
      </div>

      {/* Day equity curve */}
      <DayEquityCurve curve={stats.equityCurve} />

      {/* Trade list */}
      <div
        style={{
          background: 'var(--color-table-stripe)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {/* Table header */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: '1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr',
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {['Time', 'Side', 'Qty', 'Entry', 'Exit', 'Duration', 'Net P&L'].map((h) => (
            <div
              key={h}
              className="text-center"
              style={{ fontSize: 12, color: 'var(--color-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Trade rows */}
        {trades.map((t, idx) => {
          const isLast = idx === trades.length - 1;
          const dur = t.entry
            ? new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()
            : 0;
          const exitTime = new Date(t.exitTime).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York',
          });

          return (
            <div
              key={t.entryId}
              className="grid transition-colors"
              style={{
                gridTemplateColumns: '1fr 0.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr',
                padding: '10px 20px',
                borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
                background: idx % 2 === 1 ? hexToRgba(COLOR_TABLE_STRIPE, 0.5) : 'transparent',
              }}
            >
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
                {exitTime}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: t.isLong ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                {t.isLong ? 'Long' : 'Short'}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.totalQty}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.entryPrice != null ? t.entryPrice.toFixed(2) : '—'}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text)', fontFeatureSettings: '"tnum"' }}>
                {t.exitPrice.toFixed(2)}
              </div>
              <div className="text-center" style={{ fontSize: 13, color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>
                {dur > 0 ? formatDuration(dur) : '—'}
              </div>
              <div className="text-center" style={{ fontSize: 13, fontWeight: 600, color: pnlColor(t.totalNet), fontFeatureSettings: '"tnum"' }}>
                {fmtDollar(t.totalNet)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Day Equity Curve ─────────────────────────────────────────────────────────

interface HitPoint { x: number; y: number; label: string; value: string; sub?: string; color: string }

function drawDayCurve(ctx: CanvasRenderingContext2D, w: number, curve: number[], hitPoints: HitPoint[]) {
  if (curve.length === 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No trades', w / 2, CHART_HEIGHT / 2);
    return;
  }

  const plotW = w - PAD.left - PAD.right;
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const minY = Math.min(0, ...curve);
  const maxY = Math.max(0, ...curve);
  const rangeY = maxY - minY || 1;

  const xStep = curve.length > 1 ? plotW / (curve.length - 1) : plotW / 2;
  const toX = (i: number) => PAD.left + i * xStep;
  const toY = (v: number) => PAD.top + plotH - ((v - minY) / rangeY) * plotH;
  const zeroY = toY(0);

  // Grid
  const step = niceStep(rangeY, 3);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'right';
  const start = Math.ceil(minY / step) * step;
  for (let v = start; v <= maxY; v += step) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(w - PAD.right, y);
    ctx.stroke();
    ctx.fillText(`$${v.toFixed(0)}`, PAD.left - 8, y + 4);
  }

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PAD.left, zeroY);
  ctx.lineTo(w - PAD.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Area fills
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, zeroY - PAD.top);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < curve.length; i++) ctx.lineTo(toX(i), toY(curve[i]));
  ctx.lineTo(toX(curve.length - 1), zeroY);
  ctx.closePath();
  const gGrad = ctx.createLinearGradient(0, PAD.top, 0, zeroY);
  gGrad.addColorStop(0, hexToRgba(COLOR_BUY, 0.25));
  gGrad.addColorStop(1, hexToRgba(COLOR_BUY, 0.02));
  ctx.fillStyle = gGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, zeroY, plotW, CHART_HEIGHT - PAD.bottom - zeroY);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < curve.length; i++) ctx.lineTo(toX(i), toY(curve[i]));
  ctx.lineTo(toX(curve.length - 1), zeroY);
  ctx.closePath();
  const rGrad = ctx.createLinearGradient(0, zeroY, 0, CHART_HEIGHT - PAD.bottom);
  rGrad.addColorStop(0, hexToRgba(COLOR_SELL, 0.02));
  rGrad.addColorStop(1, hexToRgba(COLOR_SELL, 0.25));
  ctx.fillStyle = rGrad;
  ctx.fill();
  ctx.restore();

  // Line segments
  ctx.lineWidth = 1.5;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if ((prev >= 0 && curr >= 0) || (prev < 0 && curr < 0)) {
      ctx.beginPath();
      ctx.moveTo(toX(i - 1), toY(prev));
      ctx.lineTo(toX(i), toY(curr));
      ctx.strokeStyle = curr >= 0 ? COLOR_BUY : COLOR_SELL;
      ctx.stroke();
    } else {
      const t = prev / (prev - curr);
      const crossX = toX(i - 1) + t * (toX(i) - toX(i - 1));
      ctx.beginPath();
      ctx.moveTo(toX(i - 1), toY(prev));
      ctx.lineTo(crossX, zeroY);
      ctx.strokeStyle = prev >= 0 ? COLOR_BUY : COLOR_SELL;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(crossX, zeroY);
      ctx.lineTo(toX(i), toY(curr));
      ctx.strokeStyle = curr >= 0 ? COLOR_BUY : COLOR_SELL;
      ctx.stroke();
    }
  }

  // Data points + hit targets
  const tradePnl: number[] = [curve[0]];
  for (let i = 1; i < curve.length; i++) tradePnl.push(curve[i] - curve[i - 1]);

  for (let i = 0; i < curve.length; i++) {
    ctx.beginPath();
    ctx.arc(toX(i), toY(curve[i]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_TABLE_STRIPE;
    ctx.fill();
    ctx.strokeStyle = curve[i] >= 0 ? COLOR_BUY : COLOR_SELL;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const sign = tradePnl[i] > 0 ? '+' : '';
    hitPoints.push({
      x: toX(i),
      y: toY(curve[i]),
      label: `Trade #${i + 1}`,
      value: `$${curve[i] > 0 ? '+' : ''}${curve[i].toFixed(2)}`,
      sub: `Trade P&L: ${sign}$${Math.abs(tradePnl[i]).toFixed(2)}`,
      color: curve[i] >= 0 ? COLOR_BUY : COLOR_SELL,
    });
  }

  // X axis labels
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < curve.length; i++) {
    ctx.fillText(String(i + 1), toX(i), CHART_HEIGHT - 8);
  }
}

function DayEquityCurve({ curve }: { curve: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HitPoint | null>(null);
  const pointsRef = useRef<HitPoint[]>([]);
  const rectRef = useRef<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (containerRef.current) setWidth(containerRef.current.clientWidth);
    if (canvasRef.current) rectRef.current = canvasRef.current.getBoundingClientRect();
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    const pts: HitPoint[] = [];
    drawDayCurve(ctx, width, curve, pts);
    pointsRef.current = pts;
  }, [width, curve]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CHART_HEIGHT);
    const pts: HitPoint[] = [];
    drawDayCurve(ctx, width, curve, pts);
    ctx.restore();
  }, [width, curve]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!rectRef.current) rectRef.current = canvas.getBoundingClientRect();
    const rect = rectRef.current;
    const mx = e.clientX - rect.left;

    let closest: HitPoint | null = null;
    let minDist = Infinity;
    for (const p of pointsRef.current) {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist) { minDist = dist; closest = p; }
    }

    if (closest && minDist < 60) {
      setHover({ ...closest });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, CHART_HEIGHT);
      const pts: HitPoint[] = [];
      drawDayCurve(ctx, width, curve, pts);

      // Crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(closest.x, PAD.top);
      ctx.lineTo(closest.x, CHART_HEIGHT - PAD.bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD.left, closest.y);
      ctx.lineTo(width - PAD.right, closest.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Highlight dot
      ctx.beginPath();
      ctx.arc(closest.x, closest.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_TABLE_STRIPE;
      ctx.fill();
      ctx.strokeStyle = closest.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    } else {
      if (hover) { setHover(null); redraw(); }
    }
  }, [width, curve, hover, redraw]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    redraw();
  }, [redraw]);

  return (
    <div
      style={{
        background: 'var(--color-table-stripe)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '16px 20px',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12, letterSpacing: '0.02em' }}>
        Day Equity Curve
      </div>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: CHART_HEIGHT, display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {hover && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(hover.x + 12, width - 140),
              top: Math.max(hover.y - 50, 4),
              background: hexToRgba(COLOR_TABLE_STRIPE, 0.95),
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '8px 12px',
              pointerEvents: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              minWidth: 100,
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 3 }}>{hover.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: hover.color, fontFeatureSettings: '"tnum"' }}>{hover.value}</div>
            {hover.sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{hover.sub}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
