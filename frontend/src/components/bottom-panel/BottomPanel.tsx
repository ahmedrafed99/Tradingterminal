import { useStore } from '../../store/useStore';
import { TabButton } from '../shared/TabButton';
import { OrdersTab } from './OrdersTab';
import { TradesTab } from './TradesTab';
import { ConditionsTab } from './ConditionsTab';

function Separator() {
  return <div className="w-px h-4 bg-(--color-border) shrink-0" />;
}

export function BottomPanel() {
  const tab = useStore((s) => s.bottomPanelTab);
  const setTab = useStore((s) => s.setBottomPanelTab);
  const openOrders = useStore((s) => s.openOrders);
  const sessionTrades = useStore((s) => s.sessionTrades);
  const conditionServerUrl = useStore((s) => s.conditionServerUrl);
  const conditions = useStore((s) => s.conditions);

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Tab bar */}
      <div className="flex items-center h-10 shrink-0 pr-4 gap-3" style={{ marginLeft: 16 }}>
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
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto border-t border-(--color-border)">
        {tab === 'orders' && <OrdersTab />}
        {tab === 'trades' && <TradesTab />}
        {/* Keep ConditionsTab mounted (SSE connection alive) but hidden when inactive */}
        {conditionServerUrl && (
          <div className={tab === 'conditions' ? undefined : 'hidden'}>
            <ConditionsTab />
          </div>
        )}
      </div>
    </div>
  );
}
