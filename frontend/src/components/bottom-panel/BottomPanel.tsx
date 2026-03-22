import { useStore } from '../../store/useStore';
import { TabButton } from '../shared/TabButton';
import { OrdersTab } from './OrdersTab';
import { TradesTab } from './TradesTab';
import { ConditionsTab } from './ConditionsTab';
import { StatsPopover } from '../stats/StatsPopover';

function Separator() {
  return <div className="w-px h-4 bg-(--color-border) shrink-0" />;
}

export function BottomPanel() {
  const tab = useStore((s) => s.bottomPanelTab);
  const setTab = useStore((s) => s.setBottomPanelTab);
  const openOrders = useStore((s) => s.openOrders);
  const sessionTrades = useStore((s) => s.sessionTrades);
  const conditions = useStore((s) => s.conditions);

  return (
    <div className="flex flex-col h-full bg-(--color-panel)">
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
        <Separator />
        <TabButton
          label="Conditions"
          active={tab === 'conditions'}
          count={conditions.filter((c) => c.status === 'armed').length}
          onClick={() => setTab('conditions')}
        />
        <Separator />
        <TabButton
          label="Stats"
          active={tab === 'stats'}
          onClick={() => setTab(tab === 'stats' ? 'trades' : 'stats')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto border-t border-(--color-border)">
        {tab === 'orders' && <OrdersTab />}
        {(tab === 'trades' || tab === 'stats') && <TradesTab />}
        {/* Keep ConditionsTab mounted (SSE connection alive) but hidden when inactive */}
        <div className={tab === 'conditions' ? undefined : 'hidden'}>
          <ConditionsTab />
        </div>
      </div>

      {/* Stats popover */}
      {tab === 'stats' && (
        <StatsPopover onClose={() => setTab('trades')} />
      )}
    </div>
  );
}
