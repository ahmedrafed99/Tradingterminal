import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { persistenceService } from '../services/persistenceService';

/** Debounce timer for saving settings to backend */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
          // File has data — merge into store (file wins over localStorage)
          useStore.setState(saved);
        } else {
          // File is empty (first run) — seed it with current store state
          // so localStorage data gets backed up immediately
          persistenceService.saveSettings(getPersistedState()).catch(() => {});
        }
        hydrated.current = true;
      })
      .catch(() => {
        // Backend might not be running — fall back to localStorage
        hydrated.current = true;
      });
  }, []);

  // Subscribe to store changes and debounce-save to backend
  useEffect(() => {
    const unsub = useStore.subscribe(() => {
      if (!hydrated.current) return;

      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const data = getPersistedState();
        persistenceService.saveSettings(data).catch(() => {
          // Silent fail — localStorage still works as fallback
        });
      }, 500);
    });

    return () => {
      unsub();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);
}
