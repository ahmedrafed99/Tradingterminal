interface RecordingIndicatorProps {
  elapsed: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function RecordingIndicator({ elapsed }: RecordingIndicatorProps) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{
          background: 'var(--color-sell)',
          animation: 'recording-pulse 1s ease-in-out infinite',
        }}
      />
      <span
        className="text-xs text-(--color-sell)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatTime(elapsed)}
      </span>
      <style>{`
        @keyframes recording-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </span>
  );
}
