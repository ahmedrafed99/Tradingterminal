import { useStore } from '../../store/useStore';
import { TabButton } from '../shared/TabButton';
import { OrdersTab } from './OrdersTab';
import { PositionsTab } from './PositionsTab';
import { TradesTab } from './TradesTab';
import { ConditionsTab } from './ConditionsTab';
import { StatsPopover } from '../stats/StatsPopover';

export function BottomPanel() {
  const tab = useStore((s) => s.bottomPanelTab);
  const setTab = useStore((s) => s.setBottomPanelTab);
  const openOrders = useStore((s) => s.openOrders);
  const positions = useStore((s) => s.positions);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const sessionTrades = useStore((s) => s.sessionTrades);
  const conditions = useStore((s) => s.conditions);

  const positionsCount = positions.filter(
    (p) => p.size > 0 && p.accountId === activeAccountId,
  ).length;

  return (
    <div className="flex flex-col h-full bg-(--color-panel)">
      {/* Tab bar */}
      <div className="flex items-center h-10 shrink-0 pr-4 gap-6" style={{ marginLeft: 16 }}>
        <TabButton
          label="Orders"
          active={tab === 'orders'}
          count={openOrders.length}
          onClick={() => setTab('orders')}
        />
        <TabButton
          label="Positions"
          active={tab === 'positions'}
          count={positionsCount}
          onClick={() => setTab('positions')}
        />
        <TabButton
          label="Trades"
          active={tab === 'trades'}
          count={sessionTrades.filter((t) => t.profitAndLoss != null && !t.voided).length}
          onClick={() => setTab('trades')}
        />
        <TabButton
          label="Conditions"
          active={tab === 'conditions'}
          count={conditions.filter((c) => c.status === 'armed').length}
          onClick={() => setTab('conditions')}
        />
        <TabButton
          label="Stats"
          active={tab === 'stats'}
          onClick={() => setTab(tab === 'stats' ? 'trades' : 'stats')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto border-t border-(--color-border)">
        {tab === 'orders' && <OrdersTab />}
        {tab === 'positions' && <PositionsTab />}
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
