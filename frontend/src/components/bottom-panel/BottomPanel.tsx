import { useStore } from '../../store/useStore';
import { OrdersTab } from './OrdersTab';
import { TradesTab } from './TradesTab';

function TabButton({
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

function Separator() {
  return <div className="w-px h-4 bg-[#2a2e39] shrink-0" />;
}

export function BottomPanel() {
  const tab = useStore((s) => s.bottomPanelTab);
  const setTab = useStore((s) => s.setBottomPanelTab);
  const openOrders = useStore((s) => s.openOrders);
  const sessionTrades = useStore((s) => s.sessionTrades);

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Tab bar */}
      <div className="flex items-center h-10 shrink-0 border-t border-[#2a2e39] pr-4 gap-3" style={{ marginLeft: 16 }}>
        <TabButton
          label="Orders"
          active={tab === 'orders'}
          count={openOrders.length}
          onClick={() => setTab('orders')}
        />
        <Separator />
        <TabButton
          label="Trades"
          active={tab === 'trades'}
          count={sessionTrades.filter((t) => t.profitAndLoss != null && !t.voided).length}
          onClick={() => setTab('trades')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto border-t border-[#2a2e39]">
        {tab === 'orders' ? <OrdersTab /> : <TradesTab />}
      </div>
    </div>
  );
}
