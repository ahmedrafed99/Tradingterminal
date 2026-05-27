export function GridIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" stroke="none" className={className}>
      <circle cx="3.5" cy="2" r="1.2" />
      <circle cx="8.5" cy="2" r="1.2" />
      <circle cx="3.5" cy="6" r="1.2" />
      <circle cx="8.5" cy="6" r="1.2" />
      <circle cx="3.5" cy="10" r="1.2" />
      <circle cx="8.5" cy="10" r="1.2" />
    </svg>
  );
}
