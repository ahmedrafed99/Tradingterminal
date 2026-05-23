import type { Drawing, DrawingTool, FibLevel, HLineTemplate, LineStyle, RectExtendMode } from '../../types/drawing';

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------
type UndoEntry =
  | { type: 'add'; drawingId: string }
  | { type: 'update'; drawingId: string; previous: Partial<Drawing> }
  | { type: 'remove'; drawing: Drawing }
  | { type: 'clear'; drawings: Drawing[] }
  | { type: 'bulkRemove'; drawings: Drawing[] };

interface DrawingStyleDefaults {
  color: string;
  strokeWidth: number;
  lineStyle?: LineStyle;
  fillColor?: string;
  mode?: 'anchor' | 'range';
  // Rect-specific
  extendMode?: RectExtendMode;
  middleLine?: boolean;
  middleLineColor?: string;
  middleLineStyle?: LineStyle;
  // FRVP-specific
  numBars?: number;
  rowSizeMode?: 'count' | 'price';
  rowSizePrice?: number;
  rowTickSize?: number;
  pocColor?: string;
  showPoc?: boolean;
  extendPoc?: boolean;
  showBarValues?: boolean;
  valuesBgColor?: string;
  barPlacement?: 'left' | 'right' | 'middle';
  barOffset?: number;
  barLength?: number;
  volumeType?: 'total' | 'delta' | 'updown';
  // Fib-specific
  showNegative?: boolean;
  extendRight?: boolean;
  negativeMasterColor?: string;
  levels?: FibLevel[];
}

export interface DrawingsState {
  activeTool: DrawingTool;
  drawingToolbarOpen: boolean;
  selectedDrawingIds: string[];
  drawings: Drawing[];
  drawingUndoStack: UndoEntry[];
  drawingDefaults: Record<string, DrawingStyleDefaults>;
  magnetEnabled: boolean;
  magnetHeld: boolean;
  lastBarTime: number | null;
  pendingDrawingSettingsOpen: boolean;
  setPendingDrawingSettingsOpen: (v: boolean) => void;
  setLastBarTime: (t: number | null) => void;
  setMagnetHeld: (held: boolean) => void;
  setActiveTool: (tool: DrawingTool) => void;
  setDrawingToolbarOpen: (open: boolean) => void;
  setSelectedDrawingIds: (ids: string[]) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>, skipUndo?: boolean) => void;
  removeDrawing: (id: string) => void;
  removeDrawings: (ids: string[]) => void;
  pushDrawingUndo: (entry: UndoEntry) => void;
  undoDrawing: () => void;
  clearAllDrawings: () => void;
  toggleMagnet: () => void;
}

// ---------------------------------------------------------------------------
// HLine Templates
// ---------------------------------------------------------------------------
export interface HLineTemplatesState {
  hlineTemplates: HLineTemplate[];
  addHLineTemplate: (template: HLineTemplate) => void;
  removeHLineTemplate: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Custom Colors
// ---------------------------------------------------------------------------
export interface CustomColorsState {
  customColors: string[];
  addCustomColor: (color: string) => void;
  removeCustomColor: (index: number) => void;
}

export type DrawingsSlice = DrawingsState & HLineTemplatesState & CustomColorsState;

type Set = {
  (partial: Partial<DrawingsSlice>): void;
  (fn: (s: DrawingsSlice) => Partial<DrawingsSlice>): void;
};

export const createDrawingsSlice = (set: Set): DrawingsSlice => ({
  // Drawings
  activeTool: 'select' as DrawingTool,
  drawingToolbarOpen: false,
  selectedDrawingIds: [] as string[],
  drawings: [] as Drawing[],
  drawingUndoStack: [] as UndoEntry[],
  drawingDefaults: {} as Record<string, DrawingStyleDefaults>,
  magnetEnabled: false,
  magnetHeld: false,
  lastBarTime: null,
  pendingDrawingSettingsOpen: false,
  setPendingDrawingSettingsOpen: (pendingDrawingSettingsOpen) => set({ pendingDrawingSettingsOpen }),
  setLastBarTime: (lastBarTime) => set({ lastBarTime }),
  setMagnetHeld: (magnetHeld) => set({ magnetHeld }),
  setActiveTool: (activeTool) => set({ activeTool, selectedDrawingIds: [] }),
  setDrawingToolbarOpen: (drawingToolbarOpen) => set({ drawingToolbarOpen }),
  setSelectedDrawingIds: (selectedDrawingIds) => set({ selectedDrawingIds }),
  addDrawing: (drawing) =>
    set((s) => ({
      drawings: [...s.drawings, drawing],
      drawingUndoStack: [...s.drawingUndoStack, { type: 'add' as const, drawingId: drawing.id }].slice(-50),
    })),
  updateDrawing: (id, patch, skipUndo) =>
    set((s) => {
      const result: Partial<DrawingsSlice> = {
        drawings: s.drawings.map((d) => (d.id === id ? { ...d, ...patch } as Drawing : d)),
      };
      if (!skipUndo) {
        const existing = s.drawings.find((d) => d.id === id);
        const previous: Partial<Drawing> = {};
        if (existing) {
          for (const key of Object.keys(patch)) {
            (previous as Record<string, unknown>)[key] = existing[key as keyof typeof existing];
          }
        }
        result.drawingUndoStack = [
          ...s.drawingUndoStack,
          { type: 'update' as const, drawingId: id, previous },
        ].slice(-50);

        const rectKeys = ['extendMode', 'middleLine', 'middleLineColor', 'middleLineStyle'] as const;
        const frvpKeys = ['numBars', 'rowSizeMode', 'rowSizePrice', 'rowTickSize', 'pocColor', 'showPoc', 'extendPoc', 'showBarValues', 'barLength'] as const;
        const fibKeys = ['showNegative', 'extendRight', 'negativeMasterColor', 'levels'] as const;
        const styleKeys = ['color', 'strokeWidth', 'lineStyle', 'fillColor', 'mode', ...rectKeys, ...frvpKeys, ...fibKeys] as const;
        if (existing && styleKeys.some((k) => k in patch)) {
          const cur = s.drawingDefaults[existing.type] ?? { color: existing.color, strokeWidth: existing.strokeWidth };
          const typedPatch = patch as Record<string, unknown>;
          const updated: DrawingStyleDefaults = {
            color: (typedPatch.color as string) ?? cur.color,
            strokeWidth: (typedPatch.strokeWidth as number) ?? cur.strokeWidth,
          };
          if ('lineStyle' in patch || cur.lineStyle) {
            updated.lineStyle = (typedPatch.lineStyle as LineStyle) ?? cur.lineStyle;
          }
          if ('fillColor' in patch || cur.fillColor) {
            updated.fillColor = (typedPatch.fillColor as string) ?? cur.fillColor;
          }
          if ('mode' in patch || cur.mode) {
            updated.mode = (typedPatch.mode as 'anchor' | 'range') ?? cur.mode;
          }
          // FRVP-specific defaults
          if ('numBars' in patch || cur.numBars !== undefined) {
            updated.numBars = (typedPatch.numBars as number) ?? cur.numBars;
          }
          if ('rowSizeMode' in patch || cur.rowSizeMode !== undefined) {
            updated.rowSizeMode = (typedPatch.rowSizeMode as 'count' | 'price') ?? cur.rowSizeMode;
          }
          if ('rowSizePrice' in patch || cur.rowSizePrice !== undefined) {
            updated.rowSizePrice = (typedPatch.rowSizePrice as number) ?? cur.rowSizePrice;
          }
          if ('rowTickSize' in patch || cur.rowTickSize !== undefined) {
            updated.rowTickSize = (typedPatch.rowTickSize as number) ?? cur.rowTickSize;
          }
          if ('pocColor' in patch || cur.pocColor !== undefined) {
            updated.pocColor = (typedPatch.pocColor as string) ?? cur.pocColor;
          }
          if ('showPoc' in patch || cur.showPoc !== undefined) {
            updated.showPoc = (typedPatch.showPoc as boolean) ?? cur.showPoc;
          }
          if ('extendPoc' in patch || cur.extendPoc !== undefined) {
            updated.extendPoc = (typedPatch.extendPoc as boolean) ?? cur.extendPoc;
          }
          if ('showBarValues' in patch || cur.showBarValues !== undefined) {
            updated.showBarValues = (typedPatch.showBarValues as boolean) ?? cur.showBarValues;
          }
          if ('valuesBgColor' in patch || cur.valuesBgColor !== undefined) {
            updated.valuesBgColor = (typedPatch.valuesBgColor as string | undefined) ?? cur.valuesBgColor;
          }
          if ('barPlacement' in patch || cur.barPlacement !== undefined) {
            updated.barPlacement = (typedPatch.barPlacement as 'left' | 'right' | 'middle') ?? cur.barPlacement;
          }
          if ('barOffset' in patch || cur.barOffset !== undefined) {
            updated.barOffset = (typedPatch.barOffset as number) ?? cur.barOffset;
          }
          if ('barLength' in patch || cur.barLength !== undefined) {
            updated.barLength = (typedPatch.barLength as number) ?? cur.barLength;
          }
          if ('volumeType' in patch || cur.volumeType !== undefined) {
            updated.volumeType = (typedPatch.volumeType as 'total' | 'delta' | 'updown') ?? cur.volumeType;
          }
          // Rect-specific defaults
          if ('extendMode' in patch || cur.extendMode !== undefined) {
            updated.extendMode = (typedPatch.extendMode as RectExtendMode) ?? cur.extendMode;
          }
          if ('middleLine' in patch || cur.middleLine !== undefined) {
            updated.middleLine = (typedPatch.middleLine as boolean) ?? cur.middleLine;
          }
          if ('middleLineColor' in patch || cur.middleLineColor !== undefined) {
            updated.middleLineColor = (typedPatch.middleLineColor as string) ?? cur.middleLineColor;
          }
          if ('middleLineStyle' in patch || cur.middleLineStyle !== undefined) {
            updated.middleLineStyle = (typedPatch.middleLineStyle as LineStyle) ?? cur.middleLineStyle;
          }
          // Fib-specific defaults
          if ('showNegative' in patch || cur.showNegative !== undefined) {
            updated.showNegative = (typedPatch.showNegative as boolean) ?? cur.showNegative;
          }
          if ('extendRight' in patch || cur.extendRight !== undefined) {
            updated.extendRight = (typedPatch.extendRight as boolean) ?? cur.extendRight;
          }
          if ('negativeMasterColor' in patch || cur.negativeMasterColor !== undefined) {
            updated.negativeMasterColor = (typedPatch.negativeMasterColor as string) ?? cur.negativeMasterColor;
          }
          if ('levels' in patch || cur.levels !== undefined) {
            updated.levels = (typedPatch.levels as FibLevel[]) ?? cur.levels;
          }
          result.drawingDefaults = {
            ...s.drawingDefaults,
            [existing.type]: updated,
          };
        }
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
        selectedDrawingIds: s.selectedDrawingIds.filter((sid) => sid !== id),
        drawingUndoStack: drawing
          ? [...s.drawingUndoStack, { type: 'remove' as const, drawing }].slice(-50)
          : s.drawingUndoStack,
      };
    }),
  removeDrawings: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const removed = s.drawings.filter((d) => idSet.has(d.id));
      if (removed.length === 0) return s;
      return {
        drawings: s.drawings.filter((d) => !idSet.has(d.id)),
        selectedDrawingIds: [],
        drawingUndoStack: [...s.drawingUndoStack, { type: 'bulkRemove' as const, drawings: removed }].slice(-50),
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
            selectedDrawingIds: s.selectedDrawingIds.filter((id) => id !== entry.drawingId),
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
        case 'clear':
          return {
            drawingUndoStack: stack,
            drawings: entry.drawings,
          };
        case 'bulkRemove':
          return {
            drawingUndoStack: stack,
            drawings: [...s.drawings, ...entry.drawings],
          };
        default:
          return { drawingUndoStack: stack };
      }
    }),
  clearAllDrawings: () =>
    set((s) => {
      if (s.drawings.length === 0) return s;
      return {
        drawings: [],
        selectedDrawingIds: [],
        drawingUndoStack: [...s.drawingUndoStack, { type: 'clear' as const, drawings: s.drawings }].slice(-50),
      };
    }),
  toggleMagnet: () => set((s) => ({ magnetEnabled: !s.magnetEnabled })),

  // HLine Templates
  hlineTemplates: [] as HLineTemplate[],
  addHLineTemplate: (template) =>
    set((s) => ({ hlineTemplates: [...s.hlineTemplates, template] })),
  removeHLineTemplate: (id) =>
    set((s) => ({ hlineTemplates: s.hlineTemplates.filter((t) => t.id !== id) })),

  // Custom Colors
  customColors: [] as string[],
  addCustomColor: (color) =>
    set((s) => {
      const filtered = s.customColors.filter((c) => c.toLowerCase() !== color.toLowerCase());
      const next = [...filtered, color];
      return { customColors: next.length > 10 ? next.slice(next.length - 10) : next };
    }),
  removeCustomColor: (index) =>
    set((s) => ({ customColors: s.customColors.filter((_, i) => i !== index) })),
});
