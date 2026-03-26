import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Slice creators
import { createConnectionSlice } from './slices/connectionSlice';
import { createInstrumentSlice } from './slices/instrumentSlice';
import { createTradingSlice } from './slices/tradingSlice';
import { createDrawingsSlice } from './slices/drawingsSlice';
import { createLayoutSlice } from './slices/layoutSlice';
import { createConditionsSlice } from './slices/conditionsSlice';
import { createToastSlice } from './slices/toastSlice';
import { createChartSettingsSlice } from './slices/chartSettingsSlice';
import { createShortcutsSlice } from './slices/shortcutsSlice';

// Slice types
import type { ConnectionSlice } from './slices/connectionSlice';
import type { InstrumentSlice } from './slices/instrumentSlice';
import type { TradingSlice } from './slices/tradingSlice';
import type { DrawingsSlice } from './slices/drawingsSlice';
import type { LayoutSlice } from './slices/layoutSlice';
import type { ConditionsSlice } from './slices/conditionsSlice';
import type { ToastSlice } from './slices/toastSlice';
import type { ChartSettingsSlice } from './slices/chartSettingsSlice';
import type { ShortcutsSlice } from './slices/shortcutsSlice';

// Re-export commonly used types so consumers don't need to change imports
export type { Timeframe } from './slices/instrumentSlice';
export { DEFAULT_PINNED, MORE_TIMEFRAMES, TIMEFRAMES } from './slices/instrumentSlice';
export type { ToastItem } from './slices/toastSlice';

// ---------------------------------------------------------------------------
// Combined store
// ---------------------------------------------------------------------------
type Store = ConnectionSlice & InstrumentSlice & TradingSlice
  & DrawingsSlice & LayoutSlice & ConditionsSlice & ToastSlice & ChartSettingsSlice & ShortcutsSlice;

export const useStore = create<Store>()(
  persist(
    (set) => ({
      ...createConnectionSlice(set as any),
      ...createInstrumentSlice(set as any),
      ...createTradingSlice(set as any),
      ...createDrawingsSlice(set as any),
      ...createLayoutSlice(set as any),
      ...createConditionsSlice(set as any),
      ...createToastSlice(set as any),
      ...createChartSettingsSlice(set as any),
      ...createShortcutsSlice(set as any),
    }),
    {
      name: 'chart-store',
      version: 1,
      migrate: (persisted: any, version: number) => {
        if (version === 0) {
          const wasVisible = persisted.newsVisible ?? true;
          delete persisted.newsVisible;
          persisted.newsImpactFilter = wasVisible
            ? { high: true, medium: false, low: false }
            : { high: false, medium: false, low: false };
        }
        return persisted;
      },
      // Only persist settings-like data, not live state
      partialize: (s) => ({
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
        customColors: s.customColors,
        dualChart: s.dualChart,
        secondTimeframe: s.secondTimeframe,
        splitRatio: s.splitRatio,
        vpEnabled: s.vpEnabled,
        vpColor: s.vpColor,
        vpHoverExpand: s.vpHoverExpand,
        secondVpEnabled: s.secondVpEnabled,
        secondVpColor: s.secondVpColor,
        secondVpHoverExpand: s.secondVpHoverExpand,
        bidAskEnabled: s.bidAskEnabled,
        secondBidAskEnabled: s.secondBidAskEnabled,
        bottomPanelOpen: s.bottomPanelOpen,
        bottomPanelRatio: s.bottomPanelRatio,
        bottomPanelTab: s.bottomPanelTab,
        tradesDatePreset: s.tradesDatePreset === 'session' ? 'today' : s.tradesDatePreset,
        contract: s.contract,
        secondContract: s.secondContract,
        orderContract: s.orderContract,
        orderLinkedToChart: s.orderLinkedToChart,
        newsImpactFilter: s.newsImpactFilter,
        orderPanelSide: s.orderPanelSide,
        conditionServerUrl: s.conditionServerUrl,
        chartSettings: s.chartSettings,
        customShortcuts: s.customShortcuts,
        hideAccountName: s.hideAccountName,
        hideBalance: s.hideBalance,
        hideRpnl: s.hideRpnl,
        hideUpnl: s.hideUpnl,
      }),
    },
  ),
);
