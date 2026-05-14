import { useEffect, useRef, useState } from 'react';

interface SpinnerInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  inputWidth?: number;
  height?: number;
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
  inputWidth = 44,
  height = 26,
}: SpinnerInputProps) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inputStr, setInputStr] = useState(String(value));
  const valueRef = useRef(value);
  const didDragRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
    setInputStr(String(value));
  }, [value]);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

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
        onChange(clamp(startValue + steps * step));
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
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        value={inputStr}
        onChange={(e) => {
          const raw = e.target.value;
          setInputStr(raw);
          const v = parseFloat(raw);
          if (!isNaN(v)) onChange(clamp(v));
        }}
        onBlur={() => {
          const v = parseFloat(inputStr);
          const clamped = isNaN(v) ? min : clamp(v);
          onChange(clamped);
          setInputStr(String(clamped));
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: inputWidth,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text)',
          fontSize: 12,
          textAlign: 'center',
          padding: '0 4px',
          outline: 'none',
        }}
      />
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
          onClick={() => { if (!didDragRef.current) onChange(clamp(value + step)); }}
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
          onClick={() => { if (!didDragRef.current) onChange(clamp(value - step)); }}
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
