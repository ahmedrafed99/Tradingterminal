import { useEffect, useRef, useState } from 'react';

interface SpinnerInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  inputWidth?: number;
  height?: number;
  fullWidth?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  suffix?: string;
}

const PX_PER_STEP = 2;
const DRAG_THRESHOLD = 3;

/**
 * Compact numeric input with hover-reveal up/down chevron arrows.
 * Arrows support click (±1 step) and click-drag (scrub up/down).
 * Transparent background, custom border, no native browser spinners.
 */
export function SpinnerInput({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  decimals,
  inputWidth = 44,
  height = 26,
  fullWidth = false,
  textAlign = 'center',
  suffix,
}: SpinnerInputProps) {
  const fmt = (v: number) => decimals !== undefined ? v.toFixed(decimals) : String(v);

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inputStr, setInputStr] = useState(fmt(value));
  const valueRef = useRef(value);
  const didDragRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
    setInputStr(fmt(value));
  }, [value]);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  // Round to avoid float precision artifacts (e.g. 0.618 + 0.001 = 0.6190000000000001)
  const roundStep = (v: number) => {
    if (decimals !== undefined) return parseFloat(v.toFixed(decimals));
    const d = (step.toString().split('.')[1] ?? '').length;
    return d > 0 ? parseFloat(v.toFixed(d)) : v;
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const startValue = valueRef.current;
    didDragRef.current = false;

    const onMove = (me: MouseEvent) => {
      const dy = startY - me.clientY;
      if (Math.abs(dy) > DRAG_THRESHOLD) {
        if (!didDragRef.current) {
          didDragRef.current = true;
          setDragging(true);
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
        }
        const steps = Math.round(dy / PX_PER_STEP);
        onChange(clamp(roundStep(startValue + steps * step)));
      }
    };

    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'transparent',
        height,
        flexShrink: 0,
        ...(fullWidth && { width: '100%' }),
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        value={inputStr}
        onChange={(e) => {
          const raw = e.target.value;
          setInputStr(raw);
          const numericValue = parseFloat(raw);
          if (!isNaN(numericValue)) onChange(clamp(numericValue));
        }}
        onBlur={() => {
          const numericValue = parseFloat(inputStr);
          const clamped = isNaN(numericValue) ? min : clamp(numericValue);
          onChange(clamped);
          setInputStr(fmt(clamped));
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          ...(suffix
            ? { flex: 'none', width: `${Math.max(2, inputStr.length) + 0.5}ch`, boxSizing: 'content-box' }
            : fullWidth
              ? { flex: 1 }
              : { width: inputWidth }),
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text)',
          fontSize: 12,
          textAlign,
          padding: textAlign === 'left' ? '0 4px 0 10px' : textAlign === 'right' ? '0 10px 0 4px' : '0 4px',
          outline: 'none',
        }}
      />
      {suffix && (
        <>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 2,
              paddingRight: 6,
              color: 'var(--color-text)',
              fontSize: 12,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {suffix}
          </span>
          <div style={{ flex: 1 }} />
        </>
      )}
      <div
        onMouseDown={startDrag}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 16,
          opacity: hovered || dragging ? 1 : 0,
          transition: 'opacity 0.15s ease',
          pointerEvents: hovered || dragging ? 'auto' : 'none',
          cursor: dragging ? 'ns-resize' : 'pointer',
        }}
      >
        <button
          onClick={() => { if (!didDragRef.current) onChange(clamp(roundStep(value + step))); }}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            cursor: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            color: 'var(--color-text-muted)',
          }}
          className="hover:bg-(--color-hover-toolbar) hover:text-(--color-text) transition-colors"
        >
          <svg width="7" height="5" viewBox="0 0 7 5" fill="currentColor">
            <path d="M3.5 0L7 5H0z" />
          </svg>
        </button>
        <button
          onClick={() => { if (!didDragRef.current) onChange(clamp(roundStep(value - step))); }}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            cursor: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            color: 'var(--color-text-muted)',
          }}
          className="hover:bg-(--color-hover-toolbar) hover:text-(--color-text) transition-colors"
        >
          <svg width="7" height="5" viewBox="0 0 7 5" fill="currentColor">
            <path d="M3.5 5L0 0H7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
