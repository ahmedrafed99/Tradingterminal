import { useEffect, useRef } from 'react';
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

function ColorSwatch({ color, current, onClick }: { color: string; current: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        background: color,
        borderRadius: 3,
        border: color === current ? '2px solid #fff' : '1px solid #2a2e39',
        cursor: 'pointer',
        boxShadow: color === current ? '0 0 0 1px #1e222d' : 'none',
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

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
      className="absolute top-full left-0 mt-1 bg-black border border-[#2a2e39] rounded-lg shadow-lg z-50"
      style={{ padding: 10, width: 252 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Color palette grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: customColors.length > 0 ? 4 : 8 }}>
        {COLOR_PALETTE.flat().map((c, i) => (
          <ColorSwatch key={`${c}-${i}`} color={c} current={current} onClick={() => onChange(c)} />
        ))}
      </div>

      {/* Custom colors row */}
      {customColors.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
          {customColors.map((c, i) => (
            <div key={`custom-${c}-${i}`} className="relative group">
              <ColorSwatch color={c} current={current} onClick={() => onChange(c)} />
              <button
                onClick={(e) => { e.stopPropagation(); removeCustomColor(i); }}
                className="absolute opacity-0 group-hover:opacity-100"
                style={{
                  top: -4, right: -4, width: 12, height: 12,
                  borderRadius: '50%', background: '#000', border: '1px solid #434651',
                  color: '#787b86', fontSize: 8, lineHeight: '10px',
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
          border: '1px dashed #787b86',
          background: 'transparent',
          color: '#787b86',
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
        value={current}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}
