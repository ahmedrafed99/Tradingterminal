import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { DrawingTool } from '../../types/drawing';

function CursorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      <path d="M13 13l6 6" />
    </svg>
  );
}

function HLineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function OvalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="12" rx="9" ry="7" />
    </svg>
  );
}

function ArrowPathIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,18 10,10 16,14 20,6" />
      <polyline points="16,6 20,6 20,10" />
    </svg>
  );
}

function RulerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <g transform="rotate(-45 12 12)">
        <rect x="1" y="8" width="22" height="8" rx="1.5" />
        <line x1="5.5" y1="8" x2="5.5" y2="12" />
        <line x1="9" y1="8" x2="9" y2="14" />
        <line x1="12.5" y1="8" x2="12.5" y2="12" />
        <line x1="16" y1="8" x2="16" y2="14" />
        <line x1="19.5" y1="8" x2="19.5" y2="12" />
      </g>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3.75 2.5L6.25 5L3.75 7.5" />
    </svg>
  );
}

const TOOLS: { id: DrawingTool; icon: React.FC; label: string }[] = [
  { id: 'select', icon: CursorIcon, label: 'Select' },
  { id: 'hline', icon: HLineIcon, label: 'Horizontal Line' },
  { id: 'oval', icon: OvalIcon, label: 'Oval' },
  { id: 'arrowpath', icon: ArrowPathIcon, label: 'Arrow Path' },
  { id: 'ruler', icon: RulerIcon, label: 'Ruler' },
];

export function DrawingToolbar() {
  const open = useStore((s) => s.drawingToolbarOpen);
  const activeTool = useStore((s) => s.activeTool);
  const setOpen = useStore((s) => s.setDrawingToolbarOpen);
  const setTool = useStore((s) => s.setActiveTool);
  const drawings = useStore((s) => s.drawings);
  const clearAllDrawings = useStore((s) => s.clearAllDrawings);
  const [closing, setClosing] = useState(false);

  const handleToggle = () => {
    if (open && !closing) {
      setClosing(true);
    } else if (!open) {
      setOpen(true);
    }
  };

  const handleAnimationEnd = () => {
    if (closing) {
      setClosing(false);
      setOpen(false);
    }
  };

  // Show expanded panel while open OR animating out
  const showExpanded = open || closing;

  return (
    <div
      className="absolute left-0 z-30 flex flex-col items-start"
      style={{ bottom: '10%' }}
    >
      {/* Tool buttons — expand upward above the toggle button */}
      {showExpanded && (
        <div
          className={`flex flex-col bg-[#000000] border border-[#2a2e39] rounded-r-md overflow-hidden ${
            closing ? 'animate-toolbar-left-out' : 'animate-toolbar-left'
          }`}
          style={{ padding: '4px 0', marginBottom: 4 }}
          onAnimationEnd={handleAnimationEnd}
        >
          {TOOLS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              className={`flex items-center justify-center ${
                activeTool === id
                  ? 'bg-[#2a2e39] text-white'
                  : 'text-[#787b86] hover:text-white hover:bg-[#2a2e39]/50'
              }`}
              style={{ width: 36, height: 32 }}
              title={label}
            >
              <Icon />
            </button>
          ))}
          {drawings.length > 0 && (
            <>
              <div className="border-t border-[#2a2e39]" style={{ margin: '2px 6px' }} />
              <button
                onClick={clearAllDrawings}
                className="flex items-center justify-center text-[#787b86] hover:text-red-400 hover:bg-[#2a2e39]/50 transition-colors"
                style={{ width: 36, height: 32 }}
                title="Delete all drawings"
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      )}

      {/* Toggle button — always visible */}
      <button
        onClick={handleToggle}
        className="flex items-center justify-center bg-[#c8891a] border border-[#c8891a] rounded-r-md text-black hover:brightness-110"
        style={{ width: 14, height: 22 }}
        title="Drawing tools"
      >
        <ChevronRight className={`transition-transform duration-150 ${showExpanded ? 'rotate-90' : ''}`} />
      </button>
    </div>
  );
}
