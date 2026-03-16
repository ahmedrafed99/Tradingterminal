import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { persistenceService } from '../services/persistenceService';

/** Debounce timer for saving settings to backend */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Snapshot of last-saved state — skip save if nothing changed */
let lastSavedSnapshot: string | null = null;

/** Keys we persist to the backend file */
function getPersistedState() {
  const s = useStore.getState();
  return {
    baseUrl: s.baseUrl,
    activeAccountId: s.activeAccountId,
    timeframe: s.timeframe,
    pinnedTimeframes: s.pinnedTimeframes,
    pinnedInstruments: s.pinnedInstruments,
    orderSize: s.orderSize,
    bracketPresets: s.bracketPresets,
    activePresetId: s.activePresetId,
    drawings: s.drawings,
    drawingToolbarOpen: s.drawingToolbarOpen,
    drawingDefaults: s.drawingDefaults,
    hlineTemplates: s.hlineTemplates,
    dualChart: s.dualChart,
    secondTimeframe: s.secondTimeframe,
    splitRatio: s.splitRatio,
    vpEnabled: s.vpEnabled,
    vpColor: s.vpColor,
    secondVpEnabled: s.secondVpEnabled,
    secondVpColor: s.secondVpColor,
    bottomPanelOpen: s.bottomPanelOpen,
    bottomPanelRatio: s.bottomPanelRatio,
    bottomPanelTab: s.bottomPanelTab,
    contract: s.contract,
    secondContract: s.secondContract,
    orderContract: s.orderContract,
    rememberCredentials: s.rememberCredentials,
  };
}

/**
 * Hook that syncs persisted store state to the backend file system.
 * - On mount: loads settings from backend and merges into store
 * - On change: debounced save to backend (500ms)
 */
export function useSettingsSync() {
  const hydrated = useRef(false);

  // Load settings from backend on mount
  useEffect(() => {
    persistenceService
      .loadSettings()
      .then((saved) => {
        if (saved && Object.keys(saved).length > 0) {
          // File has data — merge into store (file wins over localStorage).
          // Only apply keys whose values actually changed (by value, not reference)
          // to avoid re-triggering effects that depend on object identity.
          const current = useStore.getState() as unknown as Record<string, unknown>;
          const patch: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(saved)) {
            if (JSON.stringify(current[k]) !== JSON.stringify(v)) {
              patch[k] = v;
            }
          }
          if (Object.keys(patch).length > 0) {
            useStore.setState(patch);
          }
        } else {
          // File is empty (first run) — seed it with current store state
          // so localStorage data gets backed up immediately
          persistenceService.saveSettings(getPersistedState()).catch((err) => {
            console.warn('[useSettingsSync] Initial settings seed failed:', err instanceof Error ? err.message : err);
          });
        }
        useStore.setState({ settingsHydrated: true });
        // Snapshot what we just loaded so the save handler can skip no-op saves
        lastSavedSnapshot = JSON.stringify(getPersistedState());
        // Delay enabling saves so the hydration setState doesn't trigger an immediate save-back
        requestAnimationFrame(() => { hydrated.current = true; });
      })
      .catch((err) => {
        console.warn('[useSettingsSync] Load failed, falling back to localStorage:', err instanceof Error ? err.message : err);
        useStore.setState({ settingsHydrated: true });
        lastSavedSnapshot = JSON.stringify(getPersistedState());
        requestAnimationFrame(() => { hydrated.current = true; });
      });
  }, []);

  // Subscribe to store changes and debounce-save to backend
  useEffect(() => {
    const unsub = useStore.subscribe(() => {
      if (!hydrated.current) return;

      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const data = getPersistedState();
        const snapshot = JSON.stringify(data);
        if (snapshot === lastSavedSnapshot) return; // nothing changed — skip
        lastSavedSnapshot = snapshot;
        persistenceService.saveSettings(data).catch((err) => {
          console.warn('[useSettingsSync] Save failed:', err instanceof Error ? err.message : err);
        });
      }, 500);
    });

    // Flush any pending save on page unload so the backend file is never stale
    function flushBeforeUnload() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const data = getPersistedState();
      const snapshot = JSON.stringify(data);
      if (snapshot !== lastSavedSnapshot) {
        lastSavedSnapshot = snapshot;
        // Use fetch with keepalive for reliable delivery during unload
        fetch('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true,
        }).catch((err) => {
          console.warn('[useSettingsSync] Unload flush failed:', err instanceof Error ? err.message : err);
        });
      }
    }
    window.addEventListener('beforeunload', flushBeforeUnload);

    return () => {
      unsub();
      window.removeEventListener('beforeunload', flushBeforeUnload);
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);
}
