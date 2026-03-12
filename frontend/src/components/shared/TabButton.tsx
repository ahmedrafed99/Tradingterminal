/**
 * Reusable tab button with active underline indicator.
 * Used in BottomPanel and SettingsModal.
 */
export function TabButton({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 h-full text-xs font-medium transition-colors relative cursor-pointer ${
        active
          ? 'text-(--color-text)'
          : 'text-(--color-text-muted) hover:text-(--color-text)'
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-2 text-(--color-text-muted)">({count})</span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--color-accent)" />
      )}
    </button>
  );
}
