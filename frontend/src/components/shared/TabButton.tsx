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
          ? 'text-[#d1d4dc]'
          : 'text-[#787b86] hover:text-[#d1d4dc]'
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-2 text-[#787b86]">({count})</span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2962ff]" />
      )}
    </button>
  );
}
