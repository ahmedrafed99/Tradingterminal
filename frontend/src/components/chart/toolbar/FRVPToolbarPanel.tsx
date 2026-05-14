import type { Drawing, FRVPDrawing } from '../../../types/drawing';
import { FRVPSettingsPopover } from './FRVPSettingsPopover';

interface FRVPToolbarPanelProps {
  frvp: FRVPDrawing;
  drawingId: string;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  autoTickSize: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function FRVPToolbarPanel({
  frvp,
  drawingId,
  updateDrawing,
  autoTickSize,
  open: showSettings,
  onOpenChange: setShowSettings,
}: FRVPToolbarPanelProps) {

  const btnBase = 'relative flex items-center justify-center w-8 h-8 rounded-md border-none bg-transparent cursor-pointer text-(--color-text) transition-colors duration-150';
  const btnHover = 'hover:bg-(--color-border)/50 hover:text-(--color-text)';
  const btnActive = 'bg-(--color-hover-toolbar) text-white hover:bg-(--color-border)/50';

  return (
    <div className="relative">
      <button
        onClick={() => setShowSettings((v) => !v)}
        className={`${btnBase} ${showSettings ? btnActive : btnHover}`}
        title="FRVP settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polygon points="8,1 13.66,4.25 13.66,11.75 8,15 2.34,11.75 2.34,4.25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
      </button>
      {showSettings && (
        <FRVPSettingsPopover
          frvp={frvp}
          drawingId={drawingId}
          updateDrawing={updateDrawing}
          autoTickSize={autoTickSize}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
