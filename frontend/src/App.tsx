import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { ToastContainer } from './components/Toast';

import { SettingsModal } from './components/SettingsModal';
const ConditionModal = lazy(() => import('./components/bottom-panel/ConditionModal').then(m => ({ default: m.ConditionModal })));
import { ChartArea, ChartToolbar } from './components/chart';
import { BottomPanel } from './components/bottom-panel/BottomPanel';
import { OrderPanel } from './components/order-panel';
import { authService } from './services/authService';
import { accountService } from './services/accountService';
import { marketDataService } from './services/marketDataService';
import { realtimeService } from './services/realtimeService';
import { useStore } from './store/useStore';
import { useSettingsSync } from './hooks/useSettingsSync';
import { useRemoteDrawings } from './hooks/useRemoteDrawings';
import { getCmeSessionStart } from './utils/cmeSession';
import { allTradesCache } from './components/bottom-panel/TradesTab';
import { ChevronDown } from './components/icons/ChevronDown';
import { ChevronUp } from './components/icons/ChevronUp';

function VerticalSeparator({
  containerRef,
  onDrag,
  collapsed,
  onToggle,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrag: (ratio: number) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMouseMove(e: MouseEvent) {
      const rect = rectRef.current;
      if (!rect) return;
      const ratio = (e.clientY - rect.top) / rect.height;
      onDrag(ratio);
    }
    function onMouseUp() { setDragging(false); }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onDrag]);

  return (
    <div
      className={`group relative h-1 cursor-row-resize flex-shrink-0 transition-colors ${
        dragging ? 'bg-(--color-accent)' : 'bg-(--color-separator) hover:bg-(--color-text-dim)'
      }`}
      onMouseDown={(e) => { e.preventDefault(); rectRef.current = containerRef.current?.getBoundingClientRect() ?? null; setDragging(true); }}
    >
      <button
        className={`absolute left-1/2 -translate-x-1/2 -top-2 z-10
          flex items-center justify-center rounded-sm
          bg-(--color-surface) text-(--color-text-dim) border border-(--color-border)
          hover:bg-(--color-hover-toolbar) hover:text-(--color-text)
          transition-all cursor-pointer
          ${collapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ width: 24, height: 16 }}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {collapsed ? <ChevronUp /> : <ChevronDown />}
      </button>
    </div>
  );
}

export default function App() {
  const connected = useStore((s) => s.connected);
  const settingsHydrated = useStore((s) => s.settingsHydrated);
  const contract = useStore((s) => s.contract);
  const orderContract = useStore((s) => s.orderContract);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const conditionModalOpen = useStore((s) => s.conditionModalOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const bottomPanelRatio = useStore((s) => s.bottomPanelRatio);
  const setBottomPanelRatio = useStore((s) => s.setBottomPanelRatio);
  const toggleBottomPanel = useStore((s) => s.toggleBottomPanel);
  const orderPanelSide = useStore((s) => s.orderPanelSide);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [transitioning, setTransitioning] = useState(false);

  const handleToggle = useCallback(() => {
    setTransitioning(true);
    toggleBottomPanel();
    setTimeout(() => setTransitioning(false), 200);
  }, [toggleBottomPanel]);

  // Sync settings to/from backend file storage
  useSettingsSync();

  // Poll backend for Claude-pushed drawings
  useRemoteDrawings();

  // On mount, check if the backend is already connected (e.g. after page refresh)
  useEffect(() => {
    authService
      .getStatus()
      .then(async (status) => {
        useStore.getState().setConnected(status.connected, status.baseUrl);
        if (status.connected) {
          const accounts = await accountService.searchAccounts();
          useStore.getState().setAccounts(accounts);
        }
      })
      .catch((err) => {
        console.warn('[App] Status check failed:', err instanceof Error ? err.message : err);
      });
  }, []);

  // Auto-load NQ into chart and order panel when connected (single search)
  useEffect(() => {
    if (!connected || !settingsHydrated) return;
    const { contract: c, orderContract: oc } = useStore.getState();
    if (c && oc) return; // both already set
    marketDataService
      .searchContracts('NQ')
      .then((contracts) => {
        const active = contracts.find((ct) => ct.activeContract);
        if (!active) return;
        const state = useStore.getState();
        if (!state.contract) state.setContract(active);
        if (!state.orderContract) state.setOrderContract(active);
      })
      .catch((err) => {
        console.error('[App] Auto-load NQ failed:', err instanceof Error ? err.message : err);
      });
  }, [connected, settingsHydrated]);

  // Derive session trades from allTradesCache (populated by TradesTab)
  const activeAccountId = useStore((s) => s.activeAccountId);
  const displayTradesRaw = useStore((s) => s.displayTrades);

  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    const cached = allTradesCache.get(activeAccountId);
    if (!cached) return; // Wait for TradesTab to populate the cache
    const sessionStart = getCmeSessionStart();
    useStore.getState().setSessionTrades(cached.filter((t) => t.creationTimestamp >= sessionStart));
  }, [connected, activeAccountId, displayTradesRaw]);

  // Re-fetch session trades on SignalR trade events (debounced 500ms)
  const tradeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const handler = () => {
      if (tradeDebounceRef.current) clearTimeout(tradeDebounceRef.current);
      tradeDebounceRef.current = setTimeout(() => {
        const state = useStore.getState();
        if (state.activeAccountId == null) return;
        // allTradesCache is refreshed by TradesTab's SignalR handler;
        // just re-derive session trades from the updated cache
        const cached = allTradesCache.get(state.activeAccountId!);
        if (cached) {
          const sessionStart = getCmeSessionStart();
          state.setSessionTrades(cached.filter((t) => t.creationTimestamp >= sessionStart));
        }
      }, 600); // slightly after TradesTab's 500ms to ensure cache is fresh
    };
    realtimeService.onTrade(handler);
    return () => {
      realtimeService.offTrade(handler);
      if (tradeDebounceRef.current) clearTimeout(tradeDebounceRef.current);
    };
  }, [connected]);

  return (
    <div className="flex flex-col h-screen bg-(--color-bg) text-(--color-text)">
      <TopBar />

      {/* Main content area */}
      <main className="flex-1 flex flex-row min-h-0">
        {orderPanelSide === 'left' && <OrderPanel side="left" />}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          <ChartToolbar />
          <div ref={splitContainerRef} className="flex-1 flex flex-col min-h-0">
            <div
              style={{
                flex: 1 - bottomPanelRatio,
                transition: transitioning ? 'flex 200ms ease' : 'none',
              }}
              className="flex flex-col min-h-0 overflow-hidden"
            >
              <ChartArea />
            </div>
            <VerticalSeparator
              containerRef={splitContainerRef}
              collapsed={bottomPanelRatio <= 0.05}
              onToggle={handleToggle}
              onDrag={(mouseRatio) => {
                const newRatio = 1 - mouseRatio;
                setBottomPanelRatio(newRatio);
                if (newRatio >= 0.05) {
                  useStore.getState().setBottomPanelPreviousRatio(newRatio);
                }
              }}
            />
            <div
              style={{
                flex: bottomPanelRatio,
                minHeight: 40,
                transition: transitioning ? 'flex 200ms ease, min-height 200ms ease' : 'none',
              }}
              className="overflow-hidden"
            >
              <BottomPanel />
            </div>
          </div>
        </div>
        {orderPanelSide === 'right' && <OrderPanel side="right" />}
      </main>

      {settingsOpen && <SettingsModal />}
      {conditionModalOpen && (
        <Suspense fallback={null}>
          <ConditionModal />
        </Suspense>
      )}
      <ToastContainer />
    </div>
  );
}
