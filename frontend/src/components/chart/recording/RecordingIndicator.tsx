interface RecordingIndicatorProps {
  elapsed: number;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
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
    </span>
  );
}
