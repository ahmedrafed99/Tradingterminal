import { useState, useEffect, useRef } from 'react';
import type { ScreenshotOptions } from './chartRegistry';
import { addTimeBanner } from './addTimeBanner';
import { Modal } from '../../shared/Modal';

interface SnapshotPreviewProps {
  captureChartCanvas: (options: ScreenshotOptions) => HTMLCanvasElement | null;
  onClose: () => void;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-8 h-[18px] rounded-full bg-(--color-border) peer-checked:bg-(--color-focus-ring) transition-colors" />
        <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-(--color-text-muted) peer-checked:bg-(--color-accent) peer-checked:translate-x-[14px] transition-all" />
      </div>
      <span className="text-xs text-(--color-text-medium) group-hover:text-(--color-text) transition-colors">
        {label}
      </span>
    </label>
  );
}

export function SnapshotPreview({ captureChartCanvas, onClose }: SnapshotPreviewProps) {
  const [showDrawings, setShowDrawings] = useState(true);
  const [showPositions, setShowPositions] = useState(true);
  const [showTrades, setShowTrades] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Pre-capture all 8 toggle combinations on modal open.
  // All captures run synchronously (single JS task) so the browser
  // paints only once — any chart refresh coincides with the modal appearing.
  useEffect(() => {
    const cache = new Map<string, HTMLCanvasElement>();
    for (const d of [true, false]) {
      for (const t of [true, false]) {
        for (const p of [true, false]) {
          const canvas = captureChartCanvas({ showDrawings: d, showTrades: t, showPositions: p });
          if (canvas) cache.set(`${d}-${t}-${p}`, canvas);
        }
      }
    }
    cacheRef.current = cache;
  }, [captureChartCanvas]);

  // Swap cached screenshot when any toggle changes (also fires on mount)
  useEffect(() => {
    if (cacheRef.current.size === 0) return;
    const key = `${showDrawings}-${showTrades}-${showPositions}`;
    const canvas = cacheRef.current.get(key);
    if (!canvas) return;
    canvasRef.current = canvas;
    setPreviewUrl(canvas.toDataURL('image/png'));
  }, [showDrawings, showTrades, showPositions]);

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const final = addTimeBanner(canvas);
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': new Promise((resolve) => {
            final.toBlob((blob) => resolve(blob!), 'image/png');
          }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 800);
    } catch {
      // Clipboard API may be blocked — non-critical
    }
  }

  return (
    <Modal
      onClose={onClose}
      backdropClassName="animate-backdrop-in"
      backdropStyle={{ backdropFilter: 'blur(4px)' }}
      className="bg-(--color-panel) border border-(--color-border)/60 rounded-xl flex flex-col animate-modal-in"
      style={{
        maxWidth: '75vw',
        maxHeight: '82vh',
        minWidth: 420,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '14px 20px 10px' }}>
          <div className="flex items-center gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.8">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[13px] text-(--color-text) font-medium tracking-tight">Chart Screenshot</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-(--color-border) text-(--color-text-muted) hover:text-(--color-text) hover:border-(--color-text-dim) hover:bg-(--color-border) transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview image */}
        <div className="flex-1 overflow-auto" style={{ padding: '4px 20px 16px', minHeight: 180 }}>
          {previewUrl ? (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <img
                src={previewUrl}
                alt="Chart snapshot"
                className="w-full block"
                style={{
                  maxHeight: '62vh',
                  objectFit: 'contain',
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-(--color-text-muted) text-xs">
              No chart available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-(--color-border)/50" style={{ padding: '14px 20px' }}>
          {/* Toggles */}
          <div className="flex items-center gap-5">
            <Toggle checked={showDrawings} onChange={setShowDrawings} label="Drawings" />
            <Toggle checked={showPositions} onChange={setShowPositions} label="Positions" />
            <Toggle checked={showTrades} onChange={setShowTrades} label="Trades" />
          </div>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={`text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              copied
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-(--color-border) text-(--color-text) hover:bg-(--color-hover-toolbar) active:scale-[0.97]'
            }`}
            style={{ padding: '8px 18px' }}
          >
            {copied ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy to clipboard
              </>
            )}
          </button>
        </div>
    </Modal>
  );
}
