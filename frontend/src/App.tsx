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
import { credentialService } from './services/credentialService';
import { marketDataService } from './services/marketDataService';
import { realtimeService } from './services/realtimeService';
import { useStore } from './store/useStore';
import { useSettingsSync } from './hooks/useSettingsSync';
import { useRemoteDrawings } from './hooks/useRemoteDrawings';
import { getCmeSessionStart, getDateRange } from './utils/cmeSession';
import { allTradesCache } from './components/bottom-panel/TradesTab';
import { tradeService } from './services/tradeService';
import { VerticalSeparator } from './components/shared/VerticalSeparator';
import { ChevronLeft } from './components/icons/ChevronLeft';
import { ChevronRight } from './components/icons/ChevronRight';
import { IS_DEMO } from './adapters/demo/index';

export default function App() {
  const connected = useStore((s) => s.connected);
  const settingsHydrated = useStore((s) => s.settingsHydrated);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const conditionModalOpen = useStore((s) => s.conditionModalOpen);
  const bottomPanelRatio = useStore((s) => s.bottomPanelRatio);
  const setBottomPanelRatio = useStore((s) => s.setBottomPanelRatio);
  const toggleBottomPanel = useStore((s) => s.toggleBottomPanel);
  const orderPanelSide = useStore((s) => s.orderPanelSide);
  const orderPanelOpen = useStore((s) => s.orderPanelOpen);
  const toggleOrderPanel = useStore((s) => s.toggleOrderPanel);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [bottomPanelHovered, setBottomPanelHovered] = useState(false);

  const handleToggle = useCallback(() => {
    setTransitioning(true);
    toggleBottomPanel();
    setTimeout(() => setTransitioning(false), 200);
  }, [toggleBottomPanel]);

  // Sync settings to/from backend file storage
  useSettingsSync();

  // Poll backend for Claude-pushed drawings
  useRemoteDrawings();

  // On mount: restore backend-connected adapters + auto-connect saved profiles
  useEffect(() => {
    const store = useStore.getState();

    // 1. Restore any connections already live in the backend (e.g. after page refresh)
    authService.getStatus()
      .then(async (status) => {
        if (status.connected) {
          const accounts = await accountService.searchAccounts();
          store.setAccounts(accounts);
          const restoredIds = new Set<string>();
          for (const [id, s] of Object.entries(status.exchanges ?? {})) {
            store.addConnection({ id, userName: id, baseUrl: (s as { baseUrl?: string }).baseUrl ?? 'https://api.topstepx.com', status: 'connected' });
            restoredIds.add(id);
          }
          // 2. Auto-connect saved profiles that aren't already active
          const profiles = await credentialService.loadAll();
          for (const p of profiles) {
            if (restoredIds.has(p.id)) continue; // already live
            store.addConnection({ id: p.id, userName: p.userName, label: p.label, baseUrl: p.baseUrl ?? 'https://api.topstepx.com', status: 'connecting' });
            authService.connect(p.userName, p.apiKey, p.baseUrl)
              .then(async () => {
                store.updateConnection(p.id, { status: 'connected' });
                const accts = await accountService.searchAccounts().catch(() => []);
                store.setAccounts(accts);
              })
              .catch((err) => {
                store.updateConnection(p.id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Failed' });
              });
          }
        } else {
          // Not connected — still try auto-connect from saved credentials
          const profiles = await credentialService.loadAll();
          for (const p of profiles) {
            store.addConnection({ id: p.id, userName: p.userName, label: p.label, baseUrl: p.baseUrl ?? 'https://api.topstepx.com', status: 'connecting' });
            authService.connect(p.userName, p.apiKey, p.baseUrl)
              .then(async () => {
                store.updateConnection(p.id, { status: 'connected' });
                const accts = await accountService.searchAccounts().catch(() => []);
                store.setAccounts(accts);
              })
              .catch((err) => {
                store.updateConnection(p.id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Failed' });
              });
          }
        }
      })
      .catch((err) => {
        console.warn('[App] Status check failed:', err instanceof Error ? err.message : err);
      });
  }, []);

  // Listen for backend-pushed events (e.g. remote disconnect via Telegram)
  useEffect(() => {
    if (IS_DEMO) return;
    let active = true;
    const ws = new WebSocket('ws://localhost:3001/ws/events');
    ws.onopen = () => { if (!active) ws.close(); };
    ws.onmessage = async (e) => {
      if (!active) return;
      try {
        const event = JSON.parse(e.data as string);
        if (event.type === 'disconnect') {
          await realtimeService.disconnect();
          const s = useStore.getState();
          s.connections.forEach((c) => s.removeConnection(c.id));
          s.setAccounts([]);
        }
      } catch { /* ignore malformed */ }
    };
    return () => {
      active = false;
      if (ws.readyState === WebSocket.OPEN) ws.close();
      // If still CONNECTING, onopen will close it once the handshake finishes
    };
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
        // Fetch directly — don't rely on TradesTab being mounted to refresh cache
        const { startTimestamp } = getDateRange('all');
        tradeService
          .searchTrades(state.activeAccountId, startTimestamp)
          .then((trades) => {
            allTradesCache.set(state.activeAccountId!, trades);
            const sessionStart = getCmeSessionStart();
            state.setSessionTrades(trades.filter((t) => t.creationTimestamp >= sessionStart));
          })
          .catch((err) => {
            console.error('[App] Trade re-fetch failed:', err instanceof Error ? err.message : err);
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
        {orderPanelSide === 'left' && (
          <>
            <OrderPanel side="left" collapsed={!orderPanelOpen} />
            <div className="group relative w-1 flex-shrink-0 bg-(--color-panel) transition-colors">
              <div className="absolute right-0 top-0 bottom-0 w-px bg-(--color-border) group-hover:bg-(--color-text-dim) transition-colors pointer-events-none" />
              <button
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                  flex items-center justify-center rounded-sm
                  bg-(--color-surface) text-(--color-text-dim) border border-(--color-border)
                  hover:bg-(--color-hover-toolbar) hover:text-(--color-text)
                  transition-all cursor-pointer
                  ${!orderPanelOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ width: 16, height: 24 }}
                onClick={toggleOrderPanel}
              >
                {orderPanelOpen ? <ChevronLeft /> : <ChevronRight />}
              </button>
            </div>
          </>
        )}
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
              highlighted={bottomPanelHovered}
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
              onMouseEnter={() => setBottomPanelHovered(true)}
              onMouseLeave={() => setBottomPanelHovered(false)}
            >
              <BottomPanel />
            </div>
          </div>
        </div>
        {orderPanelSide === 'right' && (
          <>
            <div className="group relative w-1 flex-shrink-0 bg-(--color-panel) transition-colors">
              <div className="absolute left-0 top-0 bottom-0 w-px bg-(--color-border) group-hover:bg-(--color-text-dim) transition-colors pointer-events-none" />
              <button
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                  flex items-center justify-center rounded-sm
                  bg-(--color-surface) text-(--color-text-dim) border border-(--color-border)
                  hover:bg-(--color-hover-toolbar) hover:text-(--color-text)
                  transition-all cursor-pointer
                  ${!orderPanelOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                style={{ width: 16, height: 24 }}
                onClick={toggleOrderPanel}
              >
                {orderPanelOpen ? <ChevronRight /> : <ChevronLeft />}
              </button>
            </div>
            <OrderPanel side="right" collapsed={!orderPanelOpen} />
          </>
        )}
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
