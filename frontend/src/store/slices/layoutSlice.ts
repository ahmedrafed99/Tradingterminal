import type { Contract } from '../../services/marketDataService';
import type { Trade } from '../../services/tradeService';
import type { NewsEvent } from '../../types/news';
import type { DatePreset } from '../../utils/cmeSession';
import type { Timeframe } from './instrumentSlice';
import { DEFAULT_PINNED } from './instrumentSlice';

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
export interface UiState {
  settingsHydrated: boolean;
  settingsOpen: boolean;
  settingsInitialTab: string | null;
  setSettingsOpen: (open: boolean) => void;
  setSettingsInitialTab: (tab: string | null) => void;
  editingPresetId: string | 'new' | null;
  setEditingPresetId: (id: string | 'new' | null) => void;
  hideAccountName: boolean;
  hideBalance: boolean;
  hideRpnl: boolean;
  hideUpnl: boolean;
  setHideAccountName: (v: boolean) => void;
  setHideBalance: (v: boolean) => void;
  setHideRpnl: (v: boolean) => void;
  setHideUpnl: (v: boolean) => void;
  copyEnabled: boolean;
  copyMasterAccountId: string | null;
  copyFollowerIds: string[];
  setCopyEnabled: (v: boolean) => void;
  setCopyMasterAccountId: (id: string | null) => void;
  setCopyFollowerIds: (ids: string[]) => void;
}

// ---------------------------------------------------------------------------
// Bottom Panel
// ---------------------------------------------------------------------------
export interface BottomPanelState {
  bottomPanelOpen: boolean;
  bottomPanelRatio: number;
  bottomPanelTab: 'orders' | 'trades' | 'conditions' | 'stats';
  tradesDatePreset: DatePreset;
  sessionTrades: Trade[];
  displayTrades: Trade[];
  visibleTradeIds: string[];
  presetCounts: Partial<Record<DatePreset, number>>;
  bottomPanelPreviousRatio: number;
  setBottomPanelPreviousRatio: (ratio: number) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelRatio: (ratio: number) => void;
  setBottomPanelTab: (tab: 'orders' | 'trades' | 'conditions' | 'stats') => void;
  toggleBottomPanel: () => void;
  setTradesDatePreset: (preset: DatePreset) => void;
  setSessionTrades: (trades: Trade[]) => void;
  setDisplayTrades: (trades: Trade[]) => void;
  toggleTradeVisibility: (tradeId: string) => void;
  toggleTradeVisibilityBulk: (tradeIds: string[]) => void;
  clearVisibleTradeIds: () => void;
  setPresetCounts: (counts: Partial<Record<DatePreset, number>>) => void;
}

// ---------------------------------------------------------------------------
// Dual Chart
// ---------------------------------------------------------------------------
export interface DualChartState {
  dualChart: boolean;
  secondContract: Contract | null;
  secondTimeframe: Timeframe;
  selectedChart: 'left' | 'right';
  splitRatio: number;
  setDualChart: (enabled: boolean) => void;
  setSecondContract: (contract: Contract) => void;
  setSecondTimeframe: (tf: Timeframe) => void;
  setSelectedChart: (side: 'left' | 'right') => void;
  setSplitRatio: (ratio: number) => void;
}

// ---------------------------------------------------------------------------
// Market Depth
// ---------------------------------------------------------------------------
export interface MarketDepthState {
  domEnabled: boolean;
  domColor: string;
  domHoverExpand: boolean;
  secondDomEnabled: boolean;
  secondDomColor: string;
  secondDomHoverExpand: boolean;
  setDomEnabled: (enabled: boolean) => void;
  setDomColor: (color: string) => void;
  setDomHoverExpand: (enabled: boolean) => void;
  setSecondDomEnabled: (enabled: boolean) => void;
  setSecondDomColor: (color: string) => void;
  setSecondDomHoverExpand: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Bid/Ask Footprint
// ---------------------------------------------------------------------------
export interface BidAskFootprintState {
  bidAskEnabled: boolean;
  secondBidAskEnabled: boolean;
  setBidAskEnabled: (enabled: boolean) => void;
  setSecondBidAskEnabled: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
export interface NewsImpactFilter {
  high: boolean;
  medium: boolean;
  low: boolean;
}

export interface NewsState {
  newsEvents: NewsEvent[];
  newsImpactFilter: NewsImpactFilter;
  setNewsEvents: (events: NewsEvent[]) => void;
  setNewsImpactFilter: (filter: NewsImpactFilter) => void;
}

// ---------------------------------------------------------------------------
// Order Panel Position
// ---------------------------------------------------------------------------
export interface OrderPanelPositionState {
  orderPanelSide: 'left' | 'right';
  setOrderPanelSide: (side: 'left' | 'right') => void;
}

export type LayoutSlice = UiState & BottomPanelState & DualChartState & MarketDepthState & BidAskFootprintState & NewsState & OrderPanelPositionState;

type Set = {
  (partial: Partial<LayoutSlice>): void;
  (fn: (s: LayoutSlice) => Partial<LayoutSlice>): void;
};

export const createLayoutSlice = (set: Set): LayoutSlice => ({
  // UI
  settingsHydrated: false,
  settingsOpen: false,
  settingsInitialTab: null,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsInitialTab: (settingsInitialTab) => set({ settingsInitialTab }),
  editingPresetId: null,
  setEditingPresetId: (editingPresetId) => set({ editingPresetId }),
  hideAccountName: false,
  hideBalance: false,
  hideRpnl: false,
  hideUpnl: false,
  setHideAccountName: (hideAccountName) => set({ hideAccountName }),
  setHideBalance: (hideBalance) => set({ hideBalance }),
  setHideRpnl: (hideRpnl) => set({ hideRpnl }),
  setHideUpnl: (hideUpnl) => set({ hideUpnl }),
  copyEnabled: false,
  copyMasterAccountId: null as string | null,
  copyFollowerIds: [] as string[],
  setCopyEnabled: (copyEnabled) => set({ copyEnabled }),
  setCopyMasterAccountId: (copyMasterAccountId) => set({ copyMasterAccountId }),
  setCopyFollowerIds: (copyFollowerIds) => set({ copyFollowerIds }),

  // Bottom Panel
  bottomPanelOpen: false,
  bottomPanelRatio: 0,
  bottomPanelPreviousRatio: 0.3,
  bottomPanelTab: 'orders' as 'orders' | 'trades' | 'conditions' | 'stats',
  tradesDatePreset: 'today' as DatePreset,
  sessionTrades: [] as Trade[],
  displayTrades: [] as Trade[],
  visibleTradeIds: [] as string[],
  presetCounts: {} as Partial<Record<DatePreset, number>>,
  setBottomPanelPreviousRatio: (bottomPanelPreviousRatio) => set({ bottomPanelPreviousRatio }),
  setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
  setBottomPanelRatio: (ratio) => set({ bottomPanelRatio: Math.max(0, Math.min(0.6, ratio)) }),
  setBottomPanelTab: (bottomPanelTab) => set({ bottomPanelTab }),
  toggleBottomPanel: () =>
    set((s) => {
      if (s.bottomPanelRatio > 0.05) {
        // Collapse: save current ratio, then collapse
        return { bottomPanelPreviousRatio: s.bottomPanelRatio, bottomPanelRatio: 0, bottomPanelOpen: false };
      } else {
        // Expand: restore previous ratio
        const ratio = s.bottomPanelPreviousRatio >= 0.05 ? s.bottomPanelPreviousRatio : 0.3;
        return { bottomPanelRatio: ratio, bottomPanelOpen: true };
      }
    }),
  setTradesDatePreset: (tradesDatePreset) => set({ tradesDatePreset }),
  setSessionTrades: (sessionTrades) => set({ sessionTrades }),
  setDisplayTrades: (displayTrades) => set({ displayTrades }),
  toggleTradeVisibility: (tradeId) =>
    set((s) => ({
      visibleTradeIds: s.visibleTradeIds.includes(tradeId)
        ? s.visibleTradeIds.filter((id) => id !== tradeId)
        : [...s.visibleTradeIds, tradeId],
    })),
  toggleTradeVisibilityBulk: (tradeIds) =>
    set((s) => {
      const allVisible = tradeIds.every((id) => s.visibleTradeIds.includes(id));
      return {
        visibleTradeIds: allVisible
          ? s.visibleTradeIds.filter((id) => !tradeIds.includes(id))
          : [...s.visibleTradeIds, ...tradeIds.filter((id) => !s.visibleTradeIds.includes(id))],
      };
    }),
  clearVisibleTradeIds: () => set({ visibleTradeIds: [] }),
  setPresetCounts: (presetCounts) => set({ presetCounts }),

  // Dual Chart
  dualChart: false,
  secondContract: null,
  secondTimeframe: DEFAULT_PINNED[0],
  selectedChart: 'left' as 'left' | 'right',
  splitRatio: 0.5,
  setDualChart: (dualChart) => set({ dualChart }),
  setSecondContract: (secondContract) => set({ secondContract }),
  setSecondTimeframe: (secondTimeframe) => set({ secondTimeframe }),
  setSelectedChart: (selectedChart) => set({ selectedChart }),
  setSplitRatio: (splitRatio) => set({ splitRatio: Math.max(0.2, Math.min(0.8, splitRatio)) }),

  // Market Depth
  domEnabled: false,
  domColor: '#808080',
  domHoverExpand: true,
  secondDomEnabled: false,
  secondDomColor: '#808080',
  secondDomHoverExpand: true,
  setDomEnabled: (domEnabled) => set({ domEnabled }),
  setDomColor: (domColor) => set({ domColor }),
  setDomHoverExpand: (domHoverExpand) => set({ domHoverExpand }),
  setSecondDomEnabled: (secondDomEnabled) => set({ secondDomEnabled }),
  setSecondDomColor: (secondDomColor) => set({ secondDomColor }),
  setSecondDomHoverExpand: (secondDomHoverExpand) => set({ secondDomHoverExpand }),

  // Bid/Ask Footprint
  bidAskEnabled: false,
  secondBidAskEnabled: false,
  setBidAskEnabled: (bidAskEnabled) => set({ bidAskEnabled }),
  setSecondBidAskEnabled: (secondBidAskEnabled) => set({ secondBidAskEnabled }),

  // Order Panel Position
  orderPanelSide: 'left' as 'left' | 'right',
  setOrderPanelSide: (orderPanelSide) => set({ orderPanelSide }),

  // News
  newsEvents: [] as NewsEvent[],
  newsImpactFilter: { high: true, medium: false, low: false } as NewsImpactFilter,
  setNewsEvents: (newsEvents) => set({ newsEvents }),
  setNewsImpactFilter: (newsImpactFilter) => set({ newsImpactFilter }),
});
