import { useStore } from '../../store/useStore';
import { Button } from '../shared/Button';
import { OrdersTab } from './OrdersTab';
import { PositionsTab } from './PositionsTab';
import { TradesTab } from './TradesTab';
import { ConditionsTab } from './ConditionsTab';
import { StrategiesTab } from './StrategiesTab';
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
        <Button variant="tab" active={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders{openOrders.length > 0 && <span className="text-(--color-text-muted)">({openOrders.length})</span>}
        </Button>
        <Button variant="tab" active={tab === 'positions'} onClick={() => setTab('positions')}>
          Positions{positionsCount > 0 && <span className="text-(--color-text-muted)">({positionsCount})</span>}
        </Button>
        <Button variant="tab" active={tab === 'trades'} onClick={() => setTab('trades')}>
          Trades{sessionTrades.filter((t) => t.profitAndLoss != null && !t.voided).length > 0 && <span className="text-(--color-text-muted)">({sessionTrades.filter((t) => t.profitAndLoss != null && !t.voided).length})</span>}
        </Button>
        <Button variant="tab" active={tab === 'conditions'} onClick={() => setTab('conditions')}>
          Conditions{conditions.filter((c) => c.status === 'armed').length > 0 && <span className="text-(--color-text-muted)">({conditions.filter((c) => c.status === 'armed').length})</span>}
        </Button>
        <Button variant="tab" active={tab === 'stats'} onClick={() => setTab(tab === 'stats' ? 'trades' : 'stats')}>
          Stats
        </Button>
        <Button variant="tab" active={tab === 'strategies'} onClick={() => setTab('strategies')}>
          Strategies
        </Button>
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
        {/* Keep StrategiesTab mounted (SSE connection alive) but hidden when inactive */}
        <div className={tab === 'strategies' ? undefined : 'hidden'}>
          <StrategiesTab />
        </div>
      </div>

      {/* Stats popover */}
      {tab === 'stats' && (
        <StatsPopover onClose={() => setTab('trades')} />
      )}
    </div>
  );
}
