import { useStore } from '../../store/useStore';
import { DatePresetSelector } from './DatePresetSelector';
import { OrdersTab } from './OrdersTab';
import { TradesTab } from './TradesTab';
import { ConditionsTab } from './ConditionsTab';

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
  const conditionServerUrl = useStore((s) => s.conditionServerUrl);
  const conditions = useStore((s) => s.conditions);
  const openConditionModal = useStore((s) => s.openConditionModal);
  const conditionPreview = useStore((s) => s.conditionPreview);
  const setConditionPreview = useStore((s) => s.setConditionPreview);

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
        {conditionServerUrl && (
          <>
            <Separator />
            <TabButton
              label="Conditions"
              active={tab === 'conditions'}
              count={conditions.filter((c) => c.status === 'armed').length}
              onClick={() => setTab('conditions')}
            />
          </>
        )}
        {conditionServerUrl && tab === 'conditions' && (
          <>
            <Separator />
            <button
              onClick={() => openConditionModal()}
              className="text-[11px] text-[#787b86] hover:text-[#d1d4dc] transition-colors cursor-pointer"
            >
              +
            </button>
            <Separator />
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={conditionPreview}
                onChange={(e) => setConditionPreview(e.target.checked)}
                className="accent-[#2962ff] w-3 h-3 cursor-pointer"
              />
              <span className={`text-[11px] transition-colors ${conditionPreview ? 'text-[#d1d4dc]' : 'text-[#787b86]'}`}>
                Preview
              </span>
            </label>
          </>
        )}
        {tab === 'trades' && (
          <>
            <Separator />
            <DatePresetSelector />
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto border-t border-[#2a2e39]">
        {tab === 'orders' ? <OrdersTab /> : tab === 'conditions' ? <ConditionsTab /> : <TradesTab />}
      </div>
    </div>
  );
}
