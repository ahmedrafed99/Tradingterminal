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
import { createBlacklistSlice } from './slices/blacklistSlice';
import { createLockoutSlice } from './slices/lockoutSlice';
import { createBacktestSlice } from './slices/backtestSlice';
import { createLiveStrategySlice } from './slices/liveStrategySlice';
import { createRiskGuardSlice } from './slices/riskGuardSlice';

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
import type { BlacklistSlice } from './slices/blacklistSlice';
import type { LockoutSlice } from './slices/lockoutSlice';
import type { BacktestSlice } from './slices/backtestSlice';
import type { LiveStrategySlice } from './slices/liveStrategySlice';
import type { RiskGuardSlice } from './slices/riskGuardSlice';

// Re-export commonly used types so consumers don't need to change imports
export type { Timeframe } from './slices/instrumentSlice';
export { DEFAULT_PINNED, MORE_TIMEFRAMES, TIMEFRAMES } from './slices/instrumentSlice';
export type { ToastItem } from './slices/toastSlice';

// ---------------------------------------------------------------------------
// Combined store
// ---------------------------------------------------------------------------

// AUTO-BUMPED by pre-commit hook when store slices change. Do not edit manually.
const STORE_VERSION = 23;

type Store = ConnectionSlice & InstrumentSlice & TradingSlice
  & DrawingsSlice & LayoutSlice & ConditionsSlice & ToastSlice & ChartSettingsSlice & ShortcutsSlice & BlacklistSlice & LockoutSlice & BacktestSlice & LiveStrategySlice & RiskGuardSlice;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createConnectionSlice(set as any),
      ...createInstrumentSlice(set as any),
      ...createTradingSlice(set as any),
      ...createDrawingsSlice(set as any),
      ...createLayoutSlice(set as any),
      ...createConditionsSlice(set as any),
      ...createToastSlice(set as any),
      ...createChartSettingsSlice(set as any),
      ...createShortcutsSlice(set as any),
      ...createBlacklistSlice(set as any, get as any),
      ...createLockoutSlice(set as any, get as any),
      ...createBacktestSlice(set as any),
      ...createLiveStrategySlice(set as any),
      ...createRiskGuardSlice(set as any),
    }),
    {
      name: 'chart-store',
      version: STORE_VERSION,
      migrate: (persisted: any, version: number) => {
        if (version > STORE_VERSION) return {}; // persisted state is newer than this code → reset
        if (version === 0) {
          const wasVisible = persisted.newsVisible ?? true;
          delete persisted.newsVisible;
          persisted.newsImpactFilter = wasVisible
            ? { high: true, medium: false, low: false }
            : { high: false, medium: false, low: false };
        }
        if (version < 2) {
          // migrate flat blacklistedSymbols array → { global, accounts }
          const old: string[] = persisted.blacklistedSymbols ?? [];
          delete persisted.blacklistedSymbols;
          persisted.blacklist = { global: old, accounts: {} };
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
        domEnabled: s.domEnabled,
        domColor: s.domColor,
        domHoverExpand: s.domHoverExpand,
        domRowLayout: s.domRowLayout,
        domRowSize: s.domRowSize,
        domBarPlacement: s.domBarPlacement,
        domBarOffset: s.domBarOffset,
        domBarLength: s.domBarLength,
        secondDomEnabled: s.secondDomEnabled,
        secondDomColor: s.secondDomColor,
        secondDomHoverExpand: s.secondDomHoverExpand,
        secondDomRowLayout: s.secondDomRowLayout,
        secondDomRowSize: s.secondDomRowSize,
        secondDomBarPlacement: s.secondDomBarPlacement,
        secondDomBarOffset: s.secondDomBarOffset,
        secondDomBarLength: s.secondDomBarLength,
        bidAskEnabled: s.bidAskEnabled,
        secondBidAskEnabled: s.secondBidAskEnabled,
        bottomPanelOpen: s.bottomPanelOpen,
        bottomPanelRatio: s.bottomPanelRatio,
        bottomPanelPreviousRatio: s.bottomPanelPreviousRatio,
        bottomPanelTab: s.bottomPanelTab,
        tradesDatePreset: s.tradesDatePreset,
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
        mllShowDistance: s.mllShowDistance,
        copyEnabled: s.copyEnabled,
        copyMasterAccountId: s.copyMasterAccountId,
        copyFollowerIds: s.copyFollowerIds,
        blacklist: s.blacklist,
        lockouts: s.lockouts,
        popoverPositions: s.popoverPositions,
        backtestOpen: s.backtestOpen,
        backtestExchange: s.backtestExchange,
        backtestSymbol: s.backtestSymbol,
        backtestFrom: s.backtestFrom,
        backtestTo: s.backtestTo,
        backtestTimeframe: s.backtestTimeframe,
        backtestStrategyName: s.backtestStrategyName,
        backtestStrategyCode: s.backtestStrategyCode,
        backtestStrategies: s.backtestStrategies,
        backtestBottomRatio: s.backtestBottomRatio,
        backtestBottomPreviousRatio: s.backtestBottomPreviousRatio,
        riskGuardEnabled: s.riskGuardEnabled,
        riskGuardMaxLoss: s.riskGuardMaxLoss,
      }),
    },
  ),
);
