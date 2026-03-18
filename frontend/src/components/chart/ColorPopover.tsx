import { useEffect, useRef, useState, useCallback } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store/useStore';

// 10-column palette matching standard design-tool layout
export const COLOR_PALETTE = [
  // Row 1 — grayscale
  ['#f2f2f2', '#e6e6e6', '#cccccc', '#b3b3b3', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a', '#000000'],
  // Row 2 — bright
  ['#ff4d4f', '#ffa500', '#ffd84d', '#a6e22e', '#1abc9c', '#00bbd4', '#4c6ef5', '#7b61ff', '#9c27b0', '#e91e63'],
  // Row 3 — light pastels
  ['#f8c8c8', '#f5deb3', '#f0e6b6', '#e8f5c8', '#cdefe3', '#c8f1f5', '#d6e4ff', '#e0d4ff', '#e8c6f0', '#f5c6d6'],
  // Row 4 — soft tones
  ['#f28b82', '#f6c26b', '#f8e71c', '#b7e778', '#48c9b0', '#4dd0e1', '#82b1ff', '#b39dff', '#ce93d8', '#f06292'],
  // Row 5 — medium tones
  ['#e57373', '#ffb74d', '#fff176', '#aed581', '#26a69a', '#26c6da', '#64b5f6', '#9575cd', '#ba68c8', '#ec407a'],
  // Row 6 — strong tones
  ['#d32f2f', '#f57c00', '#fbc02d', '#7cb342', '#00897b', '#00acc1', '#3949ab', '#5e35b1', '#8e24aa', '#c2185b'],
  // Row 7 — dark tones
  ['#b71c1c', '#e65100', '#f9a825', '#2e7d32', '#004d40', '#006064', '#1a237e', '#311b92', '#4a148c', '#880e4f'],
  // Row 8 — deepest tones
  ['#7f0000', '#bf360c', '#c68400', '#1b5e20', '#003330', '#004d50', '#0d1642', '#1a0e5b', '#2c0b3f', '#560027'],
];

// ---------------------------------------------------------------------------
// Color ↔ rgba helpers
// ---------------------------------------------------------------------------

/** Parse hex (#rrggbb) to {r, g, b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Parse an rgba(...) or hex string → { hex, opacity 0-100 } */
export function parseColorWithOpacity(color: string): { hex: string; opacity: number } {
  const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    return { hex, opacity: Math.round(a * 100) };
  }
  // Already hex
  if (color.startsWith('#')) {
    return { hex: color, opacity: 100 };
  }
  return { hex: '#ff9800', opacity: 100 };
}

/** Combine hex + opacity (0-100) → rgba() string */
export function toRgba(hex: string, opacity: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.round(opacity) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Opacity slider
// ---------------------------------------------------------------------------
export function OpacitySlider({
  hex,
  opacity,
  onChange,
}: {
  hex: string;
  opacity: number;
  onChange: (opacity: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Checkerboard + color gradient for the track
  const { r, g, b } = hexToRgb(hex);
  const gradientStyle = {
    background: `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`,
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0, width: 44 }}>
          Opacity
        </span>
        {/* Track */}
        <div
          ref={trackRef}
          style={{
            flex: 1,
            height: 16,
            borderRadius: 8,
            position: 'relative',
            cursor: 'pointer',
            // checkerboard behind the gradient
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const track = trackRef.current;
            if (!track) return;
            const update = (ev: MouseEvent) => {
              const rect = track.getBoundingClientRect();
              const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
              onChange(Math.round(pct));
            };
            update(e.nativeEvent);
            const onMove = (ev: MouseEvent) => { ev.preventDefault(); update(ev); };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        >
          {/* Color gradient overlay */}
          <div
            style={{
              ...gradientStyle,
              position: 'absolute',
              inset: 0,
              borderRadius: 8,
              pointerEvents: 'none',
            }}
          />
          {/* Thumb */}
          <div
            style={{
              position: 'absolute',
              top: -1,
              left: `${opacity}%`,
              transform: 'translateX(-50%)',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'var(--color-text-bright)',
              border: '2px solid var(--color-border)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              pointerEvents: 'none',
            }}
          />
        </div>
        {/* Percentage label */}
        <input
          type="number"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
            onChange(v);
          }}
          style={{
            color: 'var(--color-text)',
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            width: 40,
            textAlign: 'center',
            padding: '2px 0',
            outline: 'none',
            flexShrink: 0,
            MozAppearance: 'textfield',
          }}
        />
      </div>
    </div>
  );
}

function ColorSwatch({ color, current, onClick }: { color: string; current: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        background: color,
        borderRadius: 3,
        border: color === current ? '2px solid #fff' : '1px solid var(--color-border)',
        cursor: 'pointer',
        boxShadow: color === current ? '0 0 0 1px var(--color-surface)' : 'none',
      }}
    />
  );
}

export function ColorPopover({
  current,
  onChange,
  onClose,
}: {
  current: string;
  onChange: (color: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const customColors = useStore((s) => s.customColors);
  const addCustomColor = useStore((s) => s.addCustomColor);
  const removeCustomColor = useStore((s) => s.removeCustomColor);
  const parsed = parseColorWithOpacity(current);
  const [localOpacity, setLocalOpacity] = useState(parsed.opacity);

  useClickOutside(ref, true, onClose);

  // Sync opacity when current color changes externally
  useEffect(() => {
    setLocalOpacity(parseColorWithOpacity(current).opacity);
  }, [current]);

  const handleColorChange = (hex: string) => {
    onChange(toRgba(hex, localOpacity));
  };

  const handleOpacityChange = (op: number) => {
    setLocalOpacity(op);
    onChange(toRgba(parsed.hex, op));
  };

  // Save custom color only on final selection (native 'change'), not during drag
  useEffect(() => {
    const input = customInputRef.current;
    if (!input) return;
    const handler = () => addCustomColor(input.value);
    input.addEventListener('change', handler);
    return () => input.removeEventListener('change', handler);
  }, [addCustomColor]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-(--color-panel) border border-(--color-border) rounded-lg shadow-lg z-50"
      style={{ padding: 10, width: 252 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Color palette grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: customColors.length > 0 ? 4 : 8 }}>
        {COLOR_PALETTE.flat().map((c, i) => (
          <ColorSwatch key={`${c}-${i}`} color={c} current={parsed.hex} onClick={() => handleColorChange(c)} />
        ))}
      </div>

      {/* Custom colors row */}
      {customColors.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
          {customColors.map((c, i) => (
            <div key={`custom-${c}-${i}`} className="relative group">
              <ColorSwatch color={c} current={parsed.hex} onClick={() => handleColorChange(c)} />
              <button
                onClick={(e) => { e.stopPropagation(); removeCustomColor(i); }}
                className="absolute opacity-0 group-hover:opacity-100"
                style={{
                  top: -4, right: -4, width: 12, height: 12,
                  borderRadius: '50%', background: '#000', border: '1px solid var(--color-text-dim)',
                  color: 'var(--color-text-muted)', fontSize: 8, lineHeight: '10px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'opacity 0.15s',
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Custom color "+" button */}
      <button
        onClick={() => customInputRef.current?.click()}
        style={{
          width: 20,
          height: 20,
          borderRadius: 3,
          border: '1px dashed var(--color-text-muted)',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          fontSize: 14,
          lineHeight: '18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        +
      </button>
      <input
        ref={customInputRef}
        type="color"
        value={parsed.hex}
        onChange={(e) => handleColorChange(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />

      {/* Opacity slider */}
      <OpacitySlider
        hex={parsed.hex}
        opacity={localOpacity}
        onChange={handleOpacityChange}
      />
    </div>
  );
}
