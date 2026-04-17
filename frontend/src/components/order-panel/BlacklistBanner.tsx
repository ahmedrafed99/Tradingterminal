import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';

export function BlacklistBanner() {
  const { orderContract, isBlacklisted, setSettingsOpen, setSettingsInitialTab } = useStore(
    useShallow((s) => ({
      orderContract: s.orderContract,
      isBlacklisted: s.isBlacklisted,
      setSettingsOpen: s.setSettingsOpen,
      setSettingsInitialTab: s.setSettingsInitialTab,
    })),
  );

  const sym = orderContract?.name.replace(/[A-Z]\d+$/i, '') ?? null;

  if (!sym || !isBlacklisted(sym)) return null;

  return (
    <div
      className="flex items-center justify-between rounded-md"
      style={{
        padding: '7px 10px',
        background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
        borderLeft: '2px solid var(--color-warning)',
      }}
    >
      <span className="text-[11px] font-medium text-(--color-warning)">
        ⊘ {sym} blocked
      </span>
      <button
        onClick={() => { setSettingsInitialTab('trading'); setSettingsOpen(true); }}
        className="text-[11px] text-(--color-text-muted) hover:text-(--color-warning) transition-colors underline"
      >
        Manage
      </button>
    </div>
  );
}
