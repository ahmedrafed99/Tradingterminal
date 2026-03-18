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
  setSettingsOpen: (open: boolean) => void;
  editingPresetId: string | 'new' | null;
  setEditingPresetId: (id: string | 'new' | null) => void;
}

// ---------------------------------------------------------------------------
// Bottom Panel
// ---------------------------------------------------------------------------
export interface BottomPanelState {
  bottomPanelOpen: boolean;
  bottomPanelRatio: number;
  bottomPanelTab: 'orders' | 'trades' | 'conditions';
  tradesDatePreset: DatePreset;
  sessionTrades: Trade[];
  displayTrades: Trade[];
  visibleTradeIds: string[];
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelRatio: (ratio: number) => void;
  setBottomPanelTab: (tab: 'orders' | 'trades') => void;
  setTradesDatePreset: (preset: DatePreset) => void;
  setSessionTrades: (trades: Trade[]) => void;
  setDisplayTrades: (trades: Trade[]) => void;
  toggleTradeVisibility: (tradeId: string) => void;
  toggleTradeVisibilityBulk: (tradeIds: string[]) => void;
  clearVisibleTradeIds: () => void;
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
// Volume Profile
// ---------------------------------------------------------------------------
export interface VolumeProfileState {
  vpEnabled: boolean;
  vpTradeMode: boolean;
  vpColor: string;
  vpHoverExpand: boolean;
  secondVpEnabled: boolean;
  secondVpColor: string;
  secondVpHoverExpand: boolean;
  setVpEnabled: (enabled: boolean) => void;
  setVpTradeMode: (enabled: boolean) => void;
  setVpColor: (color: string) => void;
  setVpHoverExpand: (enabled: boolean) => void;
  setSecondVpEnabled: (enabled: boolean) => void;
  setSecondVpColor: (color: string) => void;
  setSecondVpHoverExpand: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
export interface NewsState {
  newsEvents: NewsEvent[];
  newsVisible: boolean;
  setNewsEvents: (events: NewsEvent[]) => void;
  setNewsVisible: (visible: boolean) => void;
}

// ---------------------------------------------------------------------------
// Order Panel Position
// ---------------------------------------------------------------------------
export interface OrderPanelPositionState {
  orderPanelSide: 'left' | 'right';
  setOrderPanelSide: (side: 'left' | 'right') => void;
}

export type LayoutSlice = UiState & BottomPanelState & DualChartState & VolumeProfileState & NewsState & OrderPanelPositionState;

type Set = {
  (partial: Partial<LayoutSlice>): void;
  (fn: (s: LayoutSlice) => Partial<LayoutSlice>): void;
};

export const createLayoutSlice = (set: Set): LayoutSlice => ({
  // UI
  settingsHydrated: false,
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  editingPresetId: null,
  setEditingPresetId: (editingPresetId) => set({ editingPresetId }),

  // Bottom Panel
  bottomPanelOpen: false,
  bottomPanelRatio: 0,
  bottomPanelTab: 'orders' as 'orders' | 'trades' | 'conditions',
  tradesDatePreset: 'today' as DatePreset,
  sessionTrades: [] as Trade[],
  displayTrades: [] as Trade[],
  visibleTradeIds: [] as string[],
  setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
  setBottomPanelRatio: (ratio) => set({ bottomPanelRatio: Math.max(0, Math.min(0.6, ratio)) }),
  setBottomPanelTab: (bottomPanelTab) => set({ bottomPanelTab }),
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

  // Volume Profile
  vpEnabled: false,
  vpTradeMode: false,
  vpColor: '#808080',
  vpHoverExpand: true,
  secondVpEnabled: false,
  secondVpColor: '#808080',
  secondVpHoverExpand: true,
  setVpEnabled: (vpEnabled) => set({ vpEnabled }),
  setVpTradeMode: (vpTradeMode) => set({ vpTradeMode }),
  setVpColor: (vpColor) => set({ vpColor }),
  setVpHoverExpand: (vpHoverExpand) => set({ vpHoverExpand }),
  setSecondVpEnabled: (secondVpEnabled) => set({ secondVpEnabled }),
  setSecondVpColor: (secondVpColor) => set({ secondVpColor }),
  setSecondVpHoverExpand: (secondVpHoverExpand) => set({ secondVpHoverExpand }),

  // Order Panel Position
  orderPanelSide: 'left' as 'left' | 'right',
  setOrderPanelSide: (orderPanelSide) => set({ orderPanelSide }),

  // News
  newsEvents: [] as NewsEvent[],
  newsVisible: true,
  setNewsEvents: (newsEvents) => set({ newsEvents }),
  setNewsVisible: (newsVisible) => set({ newsVisible }),
});
