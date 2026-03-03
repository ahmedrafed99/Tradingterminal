import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Account } from '../services/accountService';
import type { Contract } from '../services/marketDataService';
import type { Order } from '../services/orderService';
import type { RealtimePosition } from '../services/realtimeService';
import type { Trade } from '../services/tradeService';
import type { BracketPreset } from '../types/bracket';
import type { Drawing, DrawingTool, HLineTemplate } from '../types/drawing';
import { OrderSide } from '../types/enums';

// ---------------------------------------------------------------------------
// Auth slice
// ---------------------------------------------------------------------------
interface AuthState {
  connected: boolean;
  baseUrl: string;
  setConnected: (connected: boolean, baseUrl?: string) => void;
}

// ---------------------------------------------------------------------------
// Accounts slice
// ---------------------------------------------------------------------------
interface AccountsState {
  accounts: Account[];
  activeAccountId: number | null;
  setAccounts: (accounts: Account[]) => void;
  setActiveAccountId: (id: number) => void;
  updateAccount: (partial: { id: number } & Partial<Account>) => void;
}

// ---------------------------------------------------------------------------
// Instrument slice
// ---------------------------------------------------------------------------
export type Timeframe = { unit: 1|2|3|4|5|6; unitNumber: number; label: string };

export const DEFAULT_PINNED: Timeframe[] = [
  { unit: 2, unitNumber: 1,  label: '1m'  },
  { unit: 2, unitNumber: 15, label: '15m' },
];

export const MORE_TIMEFRAMES: Timeframe[] = [
  { unit: 2, unitNumber: 3,  label: '3m'  },
  { unit: 3, unitNumber: 1,  label: '1h'  },
  { unit: 3, unitNumber: 4,  label: '4h'  },
  { unit: 4, unitNumber: 1,  label: 'D'   },
];

export const TIMEFRAMES: Timeframe[] = [...DEFAULT_PINNED, ...MORE_TIMEFRAMES];

interface InstrumentState {
  contract: Contract | null;
  timeframe: Timeframe;
  pinnedTimeframes: Timeframe[];
  pinnedInstruments: string[];
  setContract: (contract: Contract) => void;
  setTimeframe: (tf: Timeframe) => void;
  pinTimeframe: (tf: Timeframe) => void;
  unpinTimeframe: (tf: Timeframe) => void;
  pinInstrument: (symbol: string) => void;
  unpinInstrument: (symbol: string) => void;
}

// ---------------------------------------------------------------------------
// Orders slice
// ---------------------------------------------------------------------------
interface OrdersState {
  openOrders: Order[];
  setOpenOrders: (orders: Order[]) => void;
  upsertOrder: (order: Order) => void;
  removeOrder: (orderId: number) => void;
}

// ---------------------------------------------------------------------------
// Positions slice
// ---------------------------------------------------------------------------
interface PositionsState {
  positions: RealtimePosition[];
  upsertPosition: (pos: RealtimePosition) => void;
  clearPositions: () => void;
}

// ---------------------------------------------------------------------------
// Trades / Realized P&L slice
// ---------------------------------------------------------------------------
interface TradesState {
  realizedPnl: number;
  realizedFees: number;
  setRealizedPnl: (pnl: number, fees: number) => void;
}

// ---------------------------------------------------------------------------
// Order Panel slice
// ---------------------------------------------------------------------------
interface OrderPanelState {
  orderContract: Contract | null;
  setOrderContract: (contract: Contract) => void;
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
  // Draft overrides (dragged preview lines — ephemeral, not persisted)
  draftSlPoints: number | null;
  draftTpPoints: (number | null)[];
  setDraftSlPoints: (p: number | null) => void;
  setDraftTpPoints: (idx: number, p: number | null) => void;
  clearDraftOverrides: () => void;
  // Ad-hoc bracket state (no preset selected — ephemeral, not persisted)
  adHocSlPoints: number | null;
  adHocTpLevels: { points: number; size: number }[];
  setAdHocSlPoints: (p: number | null) => void;
  addAdHocTp: (points: number, size: number) => void;
  removeAdHocTp: (index: number) => void;
  updateAdHocTpPoints: (index: number, points: number) => void;
  clearAdHocBrackets: () => void;
  // Quick order pending preview (+ button bracket lines awaiting fill)
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

// ---------------------------------------------------------------------------
// UI slice
// ---------------------------------------------------------------------------
interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  editingPresetId: string | 'new' | null;
  setEditingPresetId: (id: string | 'new' | null) => void;
}

// ---------------------------------------------------------------------------
// Drawings slice
// ---------------------------------------------------------------------------
type UndoEntry =
  | { type: 'add'; drawingId: string }
  | { type: 'update'; drawingId: string; previous: Partial<Drawing> }
  | { type: 'remove'; drawing: Drawing };

interface DrawingsState {
  activeTool: DrawingTool;
  drawingToolbarOpen: boolean;
  selectedDrawingId: string | null;
  drawings: Drawing[];
  drawingUndoStack: UndoEntry[];
  setActiveTool: (tool: DrawingTool) => void;
  setDrawingToolbarOpen: (open: boolean) => void;
  setSelectedDrawingId: (id: string | null) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>, skipUndo?: boolean) => void;
  removeDrawing: (id: string) => void;
  pushDrawingUndo: (entry: UndoEntry) => void;
  undoDrawing: () => void;
}

// ---------------------------------------------------------------------------
// Dual Chart slice
// ---------------------------------------------------------------------------
interface DualChartState {
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
// HLine Templates slice
// ---------------------------------------------------------------------------
interface HLineTemplatesState {
  hlineTemplates: HLineTemplate[];
  addHLineTemplate: (template: HLineTemplate) => void;
  removeHLineTemplate: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Bottom Panel slice
// ---------------------------------------------------------------------------
interface BottomPanelState {
  bottomPanelOpen: boolean;
  bottomPanelRatio: number;
  bottomPanelTab: 'orders' | 'trades';
  sessionTrades: Trade[];
  visibleTradeIds: number[];
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelRatio: (ratio: number) => void;
  setBottomPanelTab: (tab: 'orders' | 'trades') => void;
  setSessionTrades: (trades: Trade[]) => void;
  toggleTradeVisibility: (tradeId: number) => void;
  clearVisibleTradeIds: () => void;
}

// ---------------------------------------------------------------------------
// Volume Profile slice
// ---------------------------------------------------------------------------
interface VolumeProfileState {
  vpEnabled: boolean;
  vpTradeMode: boolean;
  vpColor: string;
  secondVpEnabled: boolean;
  secondVpColor: string;
  setVpEnabled: (enabled: boolean) => void;
  setVpTradeMode: (enabled: boolean) => void;
  setVpColor: (color: string) => void;
  setSecondVpEnabled: (enabled: boolean) => void;
  setSecondVpColor: (color: string) => void;
}

// ---------------------------------------------------------------------------
// Toast slice
// ---------------------------------------------------------------------------
export interface ToastItem {
  id: string;
  kind: 'error' | 'warning' | 'success' | 'info';
  title: string;
  detail?: string;
  /** Auto-dismiss duration in ms. null = manual dismiss only */
  duration: number | null;
  createdAt: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id' | 'createdAt'>) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

// ---------------------------------------------------------------------------
// Combined store
// ---------------------------------------------------------------------------
type Store = AuthState & AccountsState & InstrumentState & OrdersState
  & PositionsState & TradesState & OrderPanelState & UiState & DrawingsState & HLineTemplatesState & DualChartState & BottomPanelState & VolumeProfileState & ToastState;

export const useStore = create<Store>()(
  persist(
    (set) => ({
      // Auth
      connected: false,
      baseUrl: 'https://api.topstepx.com',
      setConnected: (connected, baseUrl) =>
        set((s) => ({ connected, baseUrl: baseUrl ?? s.baseUrl })),

      // Accounts
      accounts: [],
      activeAccountId: null,
      setAccounts: (accounts) => set({ accounts }),
      setActiveAccountId: (id) => set({ activeAccountId: id }),
      updateAccount: (partial) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === partial.id ? { ...a, ...partial } : a,
          ),
        })),

      // Instrument
      contract: null,
      timeframe: DEFAULT_PINNED[0], // default 1m
      pinnedTimeframes: DEFAULT_PINNED,
      pinnedInstruments: ['NQ', 'MNQ'],
      setContract: (contract) => set({ contract }),
      setTimeframe: (timeframe) => set({ timeframe }),
      pinTimeframe: (tf) =>
        set((s) => {
          if (s.pinnedTimeframes.some((p) => p.label === tf.label)) return s;
          return { pinnedTimeframes: [...s.pinnedTimeframes, tf] };
        }),
      unpinTimeframe: (tf) =>
        set((s) => ({
          pinnedTimeframes: s.pinnedTimeframes.filter((p) => p.label !== tf.label),
        })),
      pinInstrument: (symbol) =>
        set((s) => {
          if (s.pinnedInstruments.includes(symbol)) return s;
          return { pinnedInstruments: [...s.pinnedInstruments, symbol] };
        }),
      unpinInstrument: (symbol) =>
        set((s) => ({
          pinnedInstruments: s.pinnedInstruments.filter((p) => p !== symbol),
        })),

      // Orders
      openOrders: [],
      setOpenOrders: (openOrders) => set({ openOrders }),
      upsertOrder: (order) =>
        set((s) => {
          const idx = s.openOrders.findIndex((o) => o.id === order.id);
          if (idx === -1) return { openOrders: [...s.openOrders, order] };
          // Skip update if data is identical (prevents unnecessary re-renders)
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
          // Skip update if data is identical (prevents unnecessary re-renders)
          const prev = s.positions[idx];
          if (prev.size === pos.size && prev.averagePrice === pos.averagePrice
            && prev.type === pos.type) return s;
          const updated = [...s.positions];
          updated[idx] = pos;
          return { positions: updated };
        }),
      clearPositions: () => set({ positions: [] }),

      // Trades / Realized P&L
      realizedPnl: 0,
      realizedFees: 0,
      setRealizedPnl: (realizedPnl, realizedFees) => set({ realizedPnl, realizedFees }),

      // Order Panel
      orderContract: null,
      setOrderContract: (orderContract) => set({ orderContract }),
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
          // Clear drafts + ad-hoc when turning off
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
          // Sync orderSize if this is the active preset
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
          // Extend array if needed
          while (updated.length <= idx) updated.push(null);
          updated[idx] = points;
          return { draftTpPoints: updated };
        }),
      clearDraftOverrides: () => set({ draftSlPoints: null, draftTpPoints: [] }),

      // Ad-hoc brackets (no preset)
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

      // Bottom Panel
      bottomPanelOpen: false,
      bottomPanelRatio: 0,
      bottomPanelTab: 'orders' as 'orders' | 'trades',
      sessionTrades: [] as Trade[],
      visibleTradeIds: [] as number[],
      setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
      setBottomPanelRatio: (ratio) => set({ bottomPanelRatio: Math.max(0, Math.min(0.6, ratio)) }),
      setBottomPanelTab: (bottomPanelTab) => set({ bottomPanelTab }),
      setSessionTrades: (sessionTrades) => set({ sessionTrades }),
      toggleTradeVisibility: (tradeId) =>
        set((s) => ({
          visibleTradeIds: s.visibleTradeIds.includes(tradeId)
            ? s.visibleTradeIds.filter((id) => id !== tradeId)
            : [...s.visibleTradeIds, tradeId],
        })),
      clearVisibleTradeIds: () => set({ visibleTradeIds: [] }),

      // UI
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      editingPresetId: null,
      setEditingPresetId: (editingPresetId) => set({ editingPresetId }),

      // Drawings
      activeTool: 'select' as DrawingTool,
      drawingToolbarOpen: false,
      selectedDrawingId: null,
      drawings: [] as Drawing[],
      drawingUndoStack: [] as UndoEntry[],
      setActiveTool: (activeTool) => set({ activeTool, selectedDrawingId: null }),
      setDrawingToolbarOpen: (drawingToolbarOpen) => set({ drawingToolbarOpen }),
      setSelectedDrawingId: (selectedDrawingId) => set({ selectedDrawingId }),
      addDrawing: (drawing) =>
        set((s) => ({
          drawings: [...s.drawings, drawing],
          drawingUndoStack: [...s.drawingUndoStack, { type: 'add', drawingId: drawing.id }].slice(-50),
        })),
      updateDrawing: (id, patch, skipUndo) =>
        set((s) => {
          const result: Record<string, unknown> = {
            drawings: s.drawings.map((d) => (d.id === id ? { ...d, ...patch } as Drawing : d)),
          };
          if (!skipUndo) {
            const existing = s.drawings.find((d) => d.id === id);
            const previous: Record<string, unknown> = {};
            if (existing) {
              for (const key of Object.keys(patch)) {
                previous[key] = existing[key as keyof typeof existing];
              }
            }
            result.drawingUndoStack = [
              ...s.drawingUndoStack,
              { type: 'update', drawingId: id, previous },
            ].slice(-50);
          }
          return result;
        }),
      pushDrawingUndo: (entry) =>
        set((s) => ({
          drawingUndoStack: [...s.drawingUndoStack, entry].slice(-50),
        })),
      removeDrawing: (id) =>
        set((s) => {
          const drawing = s.drawings.find((d) => d.id === id);
          return {
            drawings: s.drawings.filter((d) => d.id !== id),
            selectedDrawingId: s.selectedDrawingId === id ? null : s.selectedDrawingId,
            drawingUndoStack: drawing
              ? [...s.drawingUndoStack, { type: 'remove', drawing }].slice(-50)
              : s.drawingUndoStack,
          };
        }),
      undoDrawing: () =>
        set((s) => {
          if (s.drawingUndoStack.length === 0) return s;
          const stack = [...s.drawingUndoStack];
          const entry = stack.pop()!;
          switch (entry.type) {
            case 'add':
              return {
                drawingUndoStack: stack,
                drawings: s.drawings.filter((d) => d.id !== entry.drawingId),
                selectedDrawingId: s.selectedDrawingId === entry.drawingId ? null : s.selectedDrawingId,
              };
            case 'update':
              return {
                drawingUndoStack: stack,
                drawings: s.drawings.map((d) =>
                  d.id === entry.drawingId ? { ...d, ...entry.previous } as Drawing : d
                ),
              };
            case 'remove':
              return {
                drawingUndoStack: stack,
                drawings: [...s.drawings, entry.drawing],
              };
            default:
              return { drawingUndoStack: stack };
          }
        }),

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
      secondVpEnabled: false,
      secondVpColor: '#808080',
      setVpEnabled: (vpEnabled) => set({ vpEnabled }),
      setVpTradeMode: (vpTradeMode) => set({ vpTradeMode }),
      setVpColor: (vpColor) => set({ vpColor }),
      setSecondVpEnabled: (secondVpEnabled) => set({ secondVpEnabled }),
      setSecondVpColor: (secondVpColor) => set({ secondVpColor }),

      // HLine Templates
      hlineTemplates: [] as HLineTemplate[],
      addHLineTemplate: (template) =>
        set((s) => ({ hlineTemplates: [...s.hlineTemplates, template] })),
      removeHLineTemplate: (id) =>
        set((s) => ({ hlineTemplates: s.hlineTemplates.filter((t) => t.id !== id) })),

      // Toasts (not persisted — live state only)
      toasts: [] as ToastItem[],
      addToast: (toast) =>
        set((s) => ({
          toasts: [
            ...s.toasts,
            {
              ...toast,
              id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              createdAt: Date.now(),
            },
          ].slice(-10),
        })),
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      clearToasts: () => set({ toasts: [] }),
    }),
    {
      name: 'chart-store',
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
      }),
    },
  ),
);
