import { useEffect, useState } from 'react';
import { RADIUS } from '../constants/layout';

interface SpinnerInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  inputWidth?: number;
  height?: number;
}

/**
 * Compact numeric input with hover-reveal up/down chevron arrows.
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
  const [inputStr, setInputStr] = useState(String(value));

  // Sync display when parent value changes externally (e.g. undo, spinner buttons)
  useEffect(() => {
    setInputStr(String(value));
  }, [value]);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        border: '1px solid var(--color-border)',
        borderRadius: RADIUS.MD,
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
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 16,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s ease',
          pointerEvents: hovered ? 'auto' : 'none',
        }}
      >
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={() => onChange(clamp(value + step))}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
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
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={() => onChange(clamp(value - step))}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
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
