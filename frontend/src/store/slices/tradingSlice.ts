import type { Contract } from '../../services/marketDataService';
import type { Order } from '../../services/orderService';
import type { RealtimePosition } from '../../services/realtimeService';
import type { BracketPreset } from '../../types/bracket';
import { OrderSide } from '../../types/enums';

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export interface OrdersState {
  openOrders: Order[];
  setOpenOrders: (orders: Order[]) => void;
  upsertOrder: (order: Order) => void;
  removeOrder: (orderId: number) => void;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export interface PositionsState {
  positions: RealtimePosition[];
  upsertPosition: (pos: RealtimePosition) => void;
  clearPositions: () => void;
}

// ---------------------------------------------------------------------------
// Order Panel
// ---------------------------------------------------------------------------
export interface OrderPanelState {
  orderContract: Contract | null;
  setOrderContract: (contract: Contract) => void;
  orderLinkedToChart: 'left' | 'right' | null;
  setOrderLinkedToChart: (linked: 'left' | 'right' | null) => void;
  orderType: 'market' | 'limit';
  limitPrice: number | null;
  orderSize: number;
  previewEnabled: boolean;
  previewSide: OrderSide;
  previewHideEntry: boolean;
  bracketPresets: BracketPreset[];
  activePresetId: string | null;
  suspendedPresetId: string | null;
  lastPrice: number | null;
  setOrderType: (t: 'market' | 'limit') => void;
  setLimitPrice: (p: number | null) => void;
  setOrderSize: (n: number) => void;
  togglePreview: () => void;
  setPreviewSide: (side: OrderSide) => void;
  setActivePresetId: (id: string | null) => void;
  suspendPreset: () => void;
  restorePreset: () => void;
  savePreset: (preset: BracketPreset) => void;
  deletePreset: (id: string) => void;
  setLastPrice: (p: number | null) => void;
  draftSlPoints: number | null;
  draftTpPoints: (number | null)[];
  setDraftSlPoints: (p: number | null) => void;
  setDraftTpPoints: (idx: number, p: number | null) => void;
  clearDraftOverrides: () => void;
  adHocSlPoints: number | null;
  adHocTpLevels: { points: number; size: number }[];
  setAdHocSlPoints: (p: number | null) => void;
  addAdHocTp: (points: number, size: number) => void;
  removeAdHocTp: (index: number) => void;
  updateAdHocTpPoints: (index: number, points: number) => void;
  clearAdHocBrackets: () => void;
  qoPendingPreview: {
    entryPrice: number;
    slPrice: number | null;
    tpPrices: number[];
    side: OrderSide;
    orderSize: number;
    tpSizes: number[];
  } | null;
  setQoPendingPreview: (preview: OrderPanelState['qoPendingPreview']) => void;
}

export type TradingSlice = OrdersState & PositionsState & OrderPanelState;

type Set = {
  (partial: Partial<TradingSlice>): void;
  (fn: (s: TradingSlice) => Partial<TradingSlice>): void;
};

export const createTradingSlice = (set: Set): TradingSlice => ({
  // Orders
  openOrders: [],
  setOpenOrders: (openOrders) => set({ openOrders }),
  upsertOrder: (order) =>
    set((s) => {
      const idx = s.openOrders.findIndex((o) => o.id === order.id);
      if (idx === -1) return { openOrders: [...s.openOrders, order] };
      const prev = s.openOrders[idx];
      if (prev.status === order.status && prev.size === order.size
        && prev.limitPrice === order.limitPrice && prev.stopPrice === order.stopPrice
        && prev.side === order.side && prev.type === order.type) return s;
      const updated = [...s.openOrders];
      updated[idx] = order;
      return { openOrders: updated };
    }),
  removeOrder: (orderId) =>
    set((s) => ({ openOrders: s.openOrders.filter((o) => o.id !== orderId) })),

  // Positions
  positions: [],
  upsertPosition: (pos) =>
    set((s) => {
      const idx = s.positions.findIndex(
        (p) => p.accountId === pos.accountId && p.contractId === pos.contractId,
      );
      if (idx === -1) return { positions: [...s.positions, pos] };
      const prev = s.positions[idx];
      if (prev.size === pos.size && prev.averagePrice === pos.averagePrice
        && prev.type === pos.type) return s;
      const updated = [...s.positions];
      updated[idx] = pos;
      return { positions: updated };
    }),
  clearPositions: () => set({ positions: [] }),

  // Order Panel
  orderContract: null,
  setOrderContract: (orderContract) => set({ orderContract }),
  orderLinkedToChart: null as 'left' | 'right' | null,
  setOrderLinkedToChart: (orderLinkedToChart) => set({ orderLinkedToChart }),
  orderType: 'market',
  limitPrice: null,
  orderSize: 1,
  previewEnabled: false,
  previewSide: OrderSide.Buy,
  previewHideEntry: false,
  bracketPresets: [],
  activePresetId: null,
  suspendedPresetId: null,
  lastPrice: null,
  setOrderType: (orderType) => set({ orderType }),
  setLimitPrice: (limitPrice) => set({ limitPrice }),
  setOrderSize: (orderSize) => set({ orderSize: Math.max(1, orderSize) }),
  togglePreview: () =>
    set((s) => ({
      previewEnabled: !s.previewEnabled,
      previewHideEntry: false,
      ...(!s.previewEnabled ? {} : { draftSlPoints: null, draftTpPoints: [], adHocSlPoints: null, adHocTpLevels: [] }),
    })),
  setPreviewSide: (previewSide) => set({ previewSide }),
  setActivePresetId: (activePresetId) =>
    set((s) => {
      const preset = activePresetId ? s.bracketPresets.find((p) => p.id === activePresetId) : null;
      const totalSize = preset ? preset.config.takeProfits.reduce((sum, tp) => sum + tp.size, 0) : 0;
      return {
        activePresetId,
        suspendedPresetId: null,
        draftSlPoints: null,
        draftTpPoints: [],
        adHocSlPoints: null,
        adHocTpLevels: [],
        ...(totalSize > 0 ? { orderSize: totalSize } : {}),
      };
    }),
  suspendPreset: () =>
    set((s) => {
      if (s.activePresetId === null) return s;
      return {
        suspendedPresetId: s.activePresetId,
        activePresetId: null,
        previewEnabled: false,
        previewHideEntry: false,
        draftSlPoints: null,
        draftTpPoints: [],
      };
    }),
  restorePreset: () =>
    set((s) => {
      if (s.suspendedPresetId === null) return s;
      const preset = s.bracketPresets.find((p) => p.id === s.suspendedPresetId);
      const totalSize = preset ? preset.config.takeProfits.reduce((sum, tp) => sum + tp.size, 0) : 0;
      return {
        activePresetId: s.suspendedPresetId,
        suspendedPresetId: null,
        ...(totalSize > 0 ? { orderSize: totalSize } : {}),
      };
    }),
  savePreset: (preset) =>
    set((s) => {
      const idx = s.bracketPresets.findIndex((p) => p.id === preset.id);
      const bracketPresets = idx === -1
        ? [...s.bracketPresets, preset]
        : s.bracketPresets.map((p, i) => (i === idx ? preset : p));
      const totalSize = preset.config.takeProfits.reduce((sum, tp) => sum + tp.size, 0);
      const syncSize = s.activePresetId === preset.id && totalSize > 0 ? { orderSize: totalSize } : {};
      return { bracketPresets, ...syncSize };
    }),
  deletePreset: (id) =>
    set((s) => ({
      bracketPresets: s.bracketPresets.filter((p) => p.id !== id),
      activePresetId: s.activePresetId === id ? null : s.activePresetId,
    })),
  setLastPrice: (lastPrice) => set({ lastPrice }),
  draftSlPoints: null,
  draftTpPoints: [],
  setDraftSlPoints: (draftSlPoints) => set({ draftSlPoints }),
  setDraftTpPoints: (idx, points) =>
    set((s) => {
      const updated = [...s.draftTpPoints];
      while (updated.length <= idx) updated.push(null);
      updated[idx] = points;
      return { draftTpPoints: updated };
    }),
  clearDraftOverrides: () => set({ draftSlPoints: null, draftTpPoints: [] }),

  // Ad-hoc brackets
  adHocSlPoints: null,
  adHocTpLevels: [],
  setAdHocSlPoints: (adHocSlPoints) => set({ adHocSlPoints }),
  addAdHocTp: (points, size) =>
    set((s) => ({ adHocTpLevels: [...s.adHocTpLevels, { points, size }] })),
  removeAdHocTp: (index) =>
    set((s) => ({ adHocTpLevels: s.adHocTpLevels.filter((_, i) => i !== index) })),
  updateAdHocTpPoints: (index, points) =>
    set((s) => ({
      adHocTpLevels: s.adHocTpLevels.map((tp, i) =>
        i === index ? { ...tp, points: Math.max(1, points) } : tp,
      ),
    })),
  clearAdHocBrackets: () => set({ adHocSlPoints: null, adHocTpLevels: [] }),
  qoPendingPreview: null,
  setQoPendingPreview: (qoPendingPreview) => set({ qoPendingPreview }),
});
