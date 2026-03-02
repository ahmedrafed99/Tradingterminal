import { useState, useEffect, useRef, useCallback } from 'react';

interface SnapshotPreviewProps {
  captureChartCanvas: (showDrawings: boolean) => HTMLCanvasElement | null;
  onClose: () => void;
}

export function SnapshotPreview({ captureChartCanvas, onClose }: SnapshotPreviewProps) {
  const [showDrawings, setShowDrawings] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const capture = useCallback((drawings: boolean) => {
    const canvas = captureChartCanvas(drawings);
    if (!canvas) return;
    canvasRef.current = canvas;
    setPreviewUrl(canvas.toDataURL('image/png'));
  }, [captureChartCanvas]);

  // Capture on mount and when showDrawings changes
  useEffect(() => {
    capture(showDrawings);
  }, [capture, showDrawings]);

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/png');
          }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 800);
    } catch (e) {
      console.error('Clipboard write failed:', e);
    }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="bg-black border border-[#2a2e39]/60 rounded-xl flex flex-col animate-modal-in"
        style={{
          maxWidth: '75vw',
          maxHeight: '82vh',
          minWidth: 420,
          boxShadow: '0 24px 80px rgba(0,0,0,0.55), 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '14px 20px 10px' }}>
          <div className="flex items-center gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#787b86" strokeWidth="1.8">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[13px] text-[#d1d4dc] font-medium tracking-tight">Chart Screenshot</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] hover:border-[#434651] hover:bg-[#2a2e39] transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview image */}
        <div className="flex-1 overflow-auto" style={{ padding: '4px 20px 16px', minHeight: 180 }}>
          {previewUrl ? (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
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
            <div className="flex items-center justify-center h-40 text-[#787b86] text-xs">
              No chart available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#2a2e39]/50" style={{ padding: '14px 20px' }}>
          {/* Drawings toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <div className="relative">
              <input
                type="checkbox"
                checked={showDrawings}
                onChange={(e) => setShowDrawings(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-[18px] rounded-full bg-[#2a2e39] peer-checked:bg-[#1e3a5f] transition-colors" />
              <div className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-[#787b86] peer-checked:bg-[#4a9eff] peer-checked:translate-x-[14px] transition-all" />
            </div>
            <span className="text-xs text-[#9598a1] group-hover:text-[#d1d4dc] transition-colors">
              Show drawings
            </span>
          </label>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className={`text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
              copied
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-[#2a2e39] text-[#d1d4dc] hover:bg-[#363a45] active:scale-[0.97]'
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
      </div>
    </div>
  );
}
