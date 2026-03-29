import { useRef, useEffect, useState, useCallback } from 'react';
import { COLOR_BUY, COLOR_SELL, COLOR_TABLE_STRIPE, COLOR_POPOVER, COLOR_TEXT_MUTED } from '../../constants/colors';
import { niceStep, hexToRgba } from './statsHelpers';

// ── Types ────────────────────────────────────────────────────────────────────

export interface HitPoint {
  x: number;
  y: number;
  label: string;
  value: string;
  sub?: string;
  color: string;
}

export interface EquityCurveConfig {
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  /** Show dots only when trade count ≤ this (0 = always show) */
  dotThreshold?: number;
  dotRadius?: number;
  gridTargetLines?: number;
}

const FONT = '13px -apple-system, BlinkMacSystemFont, sans-serif';
const TEXT_COLOR = COLOR_TEXT_MUTED;

// ── Canvas drawing ───────────────────────────────────────────────────────────

export function drawEquityCurve(
  ctx: CanvasRenderingContext2D,
  w: number,
  curve: number[],
  hitPoints: HitPoint[],
  cfg: EquityCurveConfig,
  exitTimes: string[] = [],
  progress = 1,
) {
  const { height, pad, dotThreshold = 30, dotRadius = 3, gridTargetLines = 4 } = cfg;

  if (curve.length === 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.fillText('No trades', w / 2, height / 2);
    return;
  }

  const values = progress < 1 ? curve.map((v) => v * progress) : curve;

  const plotW = w - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const minY = Math.min(0, ...curve);
  const maxY = Math.max(0, ...curve);
  const rangeY = maxY - minY || 1;

  // Centered X spacing for few trades
  const MIN_X_SPACING = 48;
  const naturalW = (curve.length - 1) * MIN_X_SPACING;
  const usedW = Math.min(naturalW, plotW);
  const xStep = curve.length > 1 ? usedW / (curve.length - 1) : 0;
  const xOffset = pad.left + (plotW - usedW) / 2;
  const toX = (i: number) => xOffset + i * xStep;
  const toY = (v: number) => pad.top + plotH - ((v - minY) / rangeY) * plotH;

  // Grid
  const step = niceStep(rangeY, gridTargetLines);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  const start = Math.ceil(minY / step) * step;
  for (let v = start; v <= maxY; v += step) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillText(`${v.toFixed(0)}$`, pad.left - 8, y + 4);
  }

  // Zero line
  const zeroY = toY(0);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(w - pad.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Area fills — green above zero, red below zero
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, zeroY - pad.top);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
  ctx.lineTo(toX(values.length - 1), zeroY);
  ctx.closePath();
  const gGrad = ctx.createLinearGradient(0, pad.top, 0, zeroY);
  gGrad.addColorStop(0, hexToRgba(COLOR_BUY, 0.25));
  gGrad.addColorStop(1, hexToRgba(COLOR_BUY, 0.02));
  ctx.fillStyle = gGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, zeroY, plotW, height - pad.bottom - zeroY);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(toX(0), zeroY);
  for (let i = 0; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
  ctx.lineTo(toX(values.length - 1), zeroY);
  ctx.closePath();
  const rGrad = ctx.createLinearGradient(0, zeroY, 0, height - pad.bottom);
  rGrad.addColorStop(0, hexToRgba(COLOR_SELL, 0.02));
  rGrad.addColorStop(1, hexToRgba(COLOR_SELL, 0.25));
  ctx.fillStyle = rGrad;
  ctx.fill();
  ctx.restore();

  // Line segments — green above zero, red below zero
  ctx.lineWidth = 1.5;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
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

  // Data point dots
  const showDots = dotThreshold === 0 || values.length <= dotThreshold;
  if (showDots) {
    for (let i = 0; i < values.length; i++) {
      ctx.beginPath();
      ctx.arc(toX(i), toY(values[i]), dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_TABLE_STRIPE;
      ctx.fill();
      ctx.strokeStyle = values[i] >= 0 ? COLOR_BUY : COLOR_SELL;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Hit points
  for (let i = 0; i < curve.length; i++) {
    const cumPnl = curve[i];
    const sign = cumPnl > 0 ? '+' : cumPnl < 0 ? '-' : '';
    const pnlStr = `${sign}$${Math.abs(cumPnl).toFixed(2)}`;
    let timeStr = '';
    if (exitTimes[i]) {
      const d = new Date(exitTimes[i]);
      timeStr = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
    }
    hitPoints.push({
      x: toX(i),
      y: toY(values[i]),
      label: `Trade #${i + 1}`,
      value: pnlStr,
      sub: timeStr,
      color: cumPnl >= 0 ? COLOR_BUY : COLOR_SELL,
    });
  }
}

// ── React component ──────────────────────────────────────────────────────────

interface EquityCurveCanvasProps {
  curve: number[];
  exitTimes?: string[];
  title: string;
  config: EquityCurveConfig;
  /** Enable entry animation (main chart uses this, day chart does not) */
  animate?: boolean;
}

export function EquityCurveCanvas({ curve, exitTimes = [], title, config, animate = false }: EquityCurveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HitPoint | null>(null);
  const pointsRef = useRef<HitPoint[]>([]);
  const rectRef = useRef<DOMRect | null>(null);
  const animRef = useRef(0);

  const { height, pad } = config;

  const measure = useCallback(() => {
    if (containerRef.current) setWidth(containerRef.current.clientWidth);
    if (overlayRef.current) rectRef.current = overlayRef.current.getBoundingClientRect();
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    const onScroll = () => {
      if (overlayRef.current) rectRef.current = overlayRef.current.getBoundingClientRect();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', onScroll, true); };
  }, [measure]);

  // Draw base canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    cancelAnimationFrame(animRef.current);

    if (animate) {
      const startTime = performance.now();
      const duration = 700;
      const frame = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const progress = 1 - Math.pow(1 - t, 3);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const pts: HitPoint[] = [];
        drawEquityCurve(ctx, width, curve, pts, config, exitTimes, progress);
        pointsRef.current = pts;
        ctx.restore();
        if (t < 1) animRef.current = requestAnimationFrame(frame);
      };
      animRef.current = requestAnimationFrame(frame);
    } else {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const pts: HitPoint[] = [];
      drawEquityCurve(ctx, width, curve, pts, config, exitTimes);
      pointsRef.current = pts;
      ctx.restore();
    }

    return () => cancelAnimationFrame(animRef.current);
  }, [width, curve, exitTimes, config, height, animate]);

  // Size overlay
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const dpr = window.devicePixelRatio || 1;
    overlay.width = width * dpr;
    overlay.height = height * dpr;
  }, [width, height]);

  const clearOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();
  }, [width, height]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!rectRef.current) rectRef.current = overlay.getBoundingClientRect();
    const rect = rectRef.current;
    const mx = e.clientX - rect.left;

    let closest: HitPoint | null = null;
    let minDist = Infinity;
    for (const p of pointsRef.current) {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist) { minDist = dist; closest = p; }
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (closest && minDist < 60) {
      setHover({ ...closest });

      // Vertical crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(closest.x, pad.top);
      ctx.lineTo(closest.x, height - pad.bottom);
      ctx.stroke();

      // Horizontal crosshair
      ctx.beginPath();
      ctx.moveTo(pad.left, closest.y);
      ctx.lineTo(width - pad.right, closest.y);
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
        ctx.font = FONT;
        const labelY = height - 10;
        const metrics = ctx.measureText(closest.sub);
        const labelPad = 4;
        ctx.fillStyle = COLOR_POPOVER;
        ctx.fillRect(closest.x - metrics.width / 2 - labelPad, labelY - 10, metrics.width + labelPad * 2, 14);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(closest.sub, closest.x, labelY);
      }
    } else {
      setHover(null);
    }

    ctx.restore();
  }, [width, height, pad]);

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    clearOverlay();
  }, [clearOverlay]);

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
      <div className="flex items-center" style={{ marginBottom: 12, position: 'relative' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.02em' }}>
          {title}
        </div>
        {hover && (
          <div
            className="flex items-center justify-center"
            style={{ position: 'absolute', left: 0, right: 0, pointerEvents: 'none', fontSize: 13 }}
          >
            <span style={{ flex: '0 0 110px', textAlign: 'center', fontWeight: 600, color: hover.color, fontFeatureSettings: '"tnum"' }}>{hover.value}</span>
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, display: 'block' }}
        />
        <canvas
          ref={overlayRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height, display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
}
