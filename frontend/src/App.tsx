import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { ToastContainer } from './components/Toast';

const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const ConditionModal = lazy(() => import('./components/bottom-panel/ConditionModal').then(m => ({ default: m.ConditionModal })));
import { ChartArea, ChartToolbar } from './components/chart';
import { BottomPanel } from './components/bottom-panel/BottomPanel';
import { OrderPanel } from './components/order-panel';
import { authService } from './services/authService';
import { marketDataService } from './services/marketDataService';
import { tradeService } from './services/tradeService';
import { realtimeService } from './services/realtimeService';
import { useStore } from './store/useStore';
import { useSettingsSync } from './hooks/useSettingsSync';
import { useRemoteDrawings } from './hooks/useRemoteDrawings';
import { getCmeSessionStart } from './utils/cmeSession';

function VerticalSeparator({
  containerRef,
  onDrag,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onDrag: (ratio: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function onMouseMove(e: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
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
  }, [dragging, containerRef, onDrag]);

  return (
    <div
      className={`h-1 cursor-row-resize flex-shrink-0 transition-colors ${
        dragging ? 'bg-(--color-accent)' : 'bg-(--color-separator) hover:bg-(--color-text-dim)'
      }`}
      onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
    />
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
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Sync settings to/from backend file storage
  useSettingsSync();

  // Poll backend for Claude-pushed drawings
  useRemoteDrawings();

  // On mount, check if the backend is already connected (e.g. after page refresh)
  useEffect(() => {
    authService
      .getStatus()
      .then((status) => {
        useStore.getState().setConnected(status.connected, status.baseUrl);
      })
      .catch((err) => {
        console.warn('[App] Status check failed:', err instanceof Error ? err.message : err);
      });
  }, []);

  // Auto-load NQ when connected and no contract selected (left chart)
  useEffect(() => {
    if (!connected || contract) return;
    marketDataService
      .searchContracts('NQ')
      .then((contracts) => {
        const active = contracts.find((c) => c.activeContract);
        if (active) useStore.getState().setContract(active);
      })
      .catch((err) => {
        console.error('[App] Auto-load NQ failed:', err instanceof Error ? err.message : err);
      });
  }, [connected, contract]);

  // Auto-load NQ into order panel when connected and no order contract selected
  useEffect(() => {
    if (!connected || !settingsHydrated || orderContract) return;
    marketDataService
      .searchContracts('NQ')
      .then((contracts) => {
        const active = contracts.find((c) => c.activeContract);
        if (active) useStore.getState().setOrderContract(active);
      })
      .catch((err) => {
        console.error('[App] Auto-load order contract failed:', err instanceof Error ? err.message : err);
      });
  }, [connected, settingsHydrated, orderContract]);

  // Fetch session trades on connect (for TopBar RPNL) — runs regardless of bottom panel tab
  const activeAccountId = useStore((s) => s.activeAccountId);
  useEffect(() => {
    if (!connected || activeAccountId == null) return;
    let cancelled = false;
    const startTimestamp = getCmeSessionStart();
    tradeService
      .searchTrades(activeAccountId, startTimestamp)
      .then((trades) => {
        if (!cancelled) useStore.getState().setSessionTrades(trades);
      })
      .catch((err) => {
        console.error('[App] Session trades fetch failed:', err instanceof Error ? err.message : err);
      });
    return () => { cancelled = true; };
  }, [connected, activeAccountId]);

  // Re-fetch session trades on SignalR trade events (debounced 500ms)
  const tradeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const handler = () => {
      if (tradeDebounceRef.current) clearTimeout(tradeDebounceRef.current);
      tradeDebounceRef.current = setTimeout(() => {
        const state = useStore.getState();
        if (state.activeAccountId == null) return;
        const sessionStart = getCmeSessionStart();
        tradeService
          .searchTrades(state.activeAccountId, sessionStart)
          .then((trades) => state.setSessionTrades(trades))
          .catch((err) => {
            console.error('[App] Trade event re-fetch failed:', err instanceof Error ? err.message : err);
          });
      }, 500);
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
        <OrderPanel />
        <div className="flex-1 flex flex-col min-h-0">
          <ChartToolbar />
          <div ref={splitContainerRef} className="flex-1 flex flex-col min-h-0">
            <div
              style={{ flex: 1 - bottomPanelRatio }}
              className="flex flex-col min-h-0 overflow-hidden"
            >
              <ChartArea />
            </div>
            <VerticalSeparator
              containerRef={splitContainerRef}
              onDrag={(mouseRatio) => {
                setBottomPanelRatio(1 - mouseRatio);
              }}
            />
            <div
              style={{ flex: bottomPanelRatio, minHeight: 40 }}
              className="overflow-hidden"
            >
              <BottomPanel />
            </div>
          </div>
        </div>
      </main>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      )}
      {conditionModalOpen && (
        <Suspense fallback={null}>
          <ConditionModal />
        </Suspense>
      )}
      <ToastContainer />
    </div>
  );
}
