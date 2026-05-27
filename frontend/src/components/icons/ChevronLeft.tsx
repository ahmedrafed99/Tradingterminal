export function ChevronLeft({ size = 10, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M6.25 2.5L3.75 5L6.25 7.5" />
    </svg>
  );
}
