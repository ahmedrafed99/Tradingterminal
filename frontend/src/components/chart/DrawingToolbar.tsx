import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { DrawingTool } from '../../types/drawing';

function HLineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
      <path d="M8.5 15h16.5v-1h-16.5z" />
      <path d="M6.5 16c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
      <path d="M7.5 6h13v-1h-13z" />
      <path d="M7.5 23h13v-1h-13z" />
      <path d="M5 7.5v13h1v-13z" />
      <path d="M22 7.5v13h1v-13z" />
      <path d="M5.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM22.5 7c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM22.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM5.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" />
    </svg>
  );
}

function OvalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
      <path d="M12.435 6.136c-4.411.589-7.983 3.039-9.085 6.27l.946.323c.967-2.836 4.209-5.059 8.271-5.602l-.132-.991zM3.347 16.584c1.101 3.243 4.689 5.701 9.117 6.283l.13-.991c-4.079-.537-7.335-2.767-8.301-5.613l-.947.321zM16.554 22.865c4.381-.582 7.94-3 9.071-6.2l-.943-.333c-.994 2.811-4.224 5.006-8.26 5.542l.132.991zM25.646 12.394c-1.107-3.225-4.675-5.668-9.078-6.257l-.133.991c4.056.542 7.293 2.76 8.265 5.591l.946-.325z" />
      <path d="M14.5 8c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM14.5 24c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM3.5 16c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5zM25.5 16c.828 0 1.5-.672 1.5-1.5s-.672-1.5-1.5-1.5-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm0 1c-1.381 0-2.5-1.119-2.5-2.5s1.119-2.5 2.5-2.5 2.5 1.119 2.5 2.5-1.119 2.5-2.5 2.5z" />
    </svg>
  );
}

function ArrowPathIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
      <path d="M11 10.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm4 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm11-8.8V13h1V7h-6v1h4.3l-7.42 7.41a2.49 2.49 0 0 0-2.76 0l-3.53-3.53a2.5 2.5 0 1 0-4.17 0L1 18.29l.7.71 6.42-6.41a2.49 2.49 0 0 0 2.76 0l3.53 3.53a2.5 2.5 0 1 0 4.17 0z" />
    </svg>
  );
}

function BrushIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor" fillRule="nonzero">
      <path d="M1.789 23l.859-.854.221-.228c.18-.19.38-.409.597-.655.619-.704 1.238-1.478 1.815-2.298.982-1.396 1.738-2.776 2.177-4.081 1.234-3.667 5.957-4.716 8.923-1.263 3.251 3.785-.037 9.38-5.379 9.38h-9.211zm9.211-1c4.544 0 7.272-4.642 4.621-7.728-2.45-2.853-6.225-2.015-7.216.931-.474 1.408-1.273 2.869-2.307 4.337-.599.852-1.241 1.653-1.882 2.383l-.068.078h6.853z" />
      <path d="M18.182 6.002l-1.419 1.286c-1.031.935-1.075 2.501-.096 3.48l1.877 1.877c.976.976 2.553.954 3.513-.045l5.65-5.874-.721-.693-5.65 5.874c-.574.596-1.507.609-2.086.031l-1.877-1.877c-.574-.574-.548-1.48.061-2.032l1.419-1.286-.672-.741z" />
    </svg>
  );
}

function RulerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
      <path d="M2 9.75a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h24a1.5 1.5 0 0 0 1.5-1.5v-5.5a1.5 1.5 0 0 0-1.5-1.5zm0 1h3v2.5h1v-2.5h3.25v3.9h1v-3.9h3.25v2.5h1v-2.5h3.25v3.9h1v-3.9H22v2.5h1v-2.5h3a.5.5 0 0 1 .5.5v5.5a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5v-5.5a.5.5 0 0 1 .5-.5z" transform="rotate(-45 14 14)" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 28 28" shapeRendering="geometricPrecision" fill="currentColor">
      <path d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z" />
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
{ id: 'hline', icon: HLineIcon, label: 'Horizontal Line' },
  { id: 'rect', icon: RectIcon, label: 'Rectangle' },
  { id: 'oval', icon: OvalIcon, label: 'Oval' },
  { id: 'arrowpath', icon: ArrowPathIcon, label: 'Arrow Path' },
  { id: 'ruler', icon: RulerIcon, label: 'Ruler' },
  { id: 'freedraw', icon: BrushIcon, label: 'Free Draw' },
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
          className={`flex flex-col bg-(--color-panel) border border-(--color-border) rounded-r-md overflow-hidden ${
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
                  ? 'bg-(--color-border) text-white'
                  : 'text-(--color-text-muted) hover:text-white hover:bg-(--color-border)/50'
              }`}
              style={{ width: 36, height: 34 }}
              title={label}
            >
              <Icon />
            </button>
          ))}
          <div className="border-t border-(--color-border)" style={{ margin: '2px 6px' }} />
          <button
            onClick={clearAllDrawings}
            disabled={drawings.length === 0}
            className={`flex items-center justify-center transition-colors ${
              drawings.length > 0
                ? 'text-(--color-text-muted) hover:text-red-400 hover:bg-(--color-border)/50'
                : 'text-(--color-text-muted) disabled:opacity-50 cursor-default'
            }`}
            style={{ width: 36, height: 34 }}
            title="Delete all drawings"
          >
            <TrashIcon />
          </button>
        </div>
      )}

      {/* Toggle button — always visible */}
      <button
        onClick={handleToggle}
        className="flex items-center justify-center bg-(--color-warning) border border-(--color-warning) rounded-r-md text-black hover:brightness-110"
        style={{ width: 14, height: 22 }}
        title="Drawing tools"
      >
        <ChevronRight className={`transition-transform duration-150 ${showExpanded ? 'rotate-90' : ''}`} />
      </button>
    </div>
  );
}
