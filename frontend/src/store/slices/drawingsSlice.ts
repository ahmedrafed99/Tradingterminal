import type { Drawing, DrawingTool, HLineTemplate, LineStyle } from '../../types/drawing';

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
  // FRVP-specific
  numBars?: number;
  rowSizeMode?: 'count' | 'price';
  rowSizePrice?: number;
  rowTickSize?: number;
  pocColor?: string;
  showPoc?: boolean;
  extendPoc?: boolean;
  showBarValues?: boolean;
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
  setLastBarTime: (lastBarTime) => set({ lastBarTime }),
  setMagnetHeld: (magnetHeld) => set({ magnetHeld }),
  setActiveTool: (activeTool) => set({ activeTool, selectedDrawingIds: [] }),
  setDrawingToolbarOpen: (drawingToolbarOpen) => set({ drawingToolbarOpen }),
  setSelectedDrawingIds: (selectedDrawingIds) => set({ selectedDrawingIds }),
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

        const frvpKeys = ['numBars', 'pocColor', 'showPoc', 'extendPoc', 'showBarValues'] as const;
        const styleKeys = ['color', 'strokeWidth', 'lineStyle', 'fillColor', 'mode', ...frvpKeys] as const;
        if (existing && styleKeys.some((k) => k in patch)) {
          const cur = s.drawingDefaults[existing.type] ?? { color: existing.color, strokeWidth: existing.strokeWidth };
          const p = patch as Record<string, unknown>;
          const updated: DrawingStyleDefaults = {
            color: (p.color as string) ?? cur.color,
            strokeWidth: (p.strokeWidth as number) ?? cur.strokeWidth,
          };
          if ('lineStyle' in patch || cur.lineStyle) {
            updated.lineStyle = (p.lineStyle as LineStyle) ?? cur.lineStyle;
          }
          if ('fillColor' in patch || cur.fillColor) {
            updated.fillColor = (p.fillColor as string) ?? cur.fillColor;
          }
          if ('mode' in patch || cur.mode) {
            updated.mode = (p.mode as 'anchor' | 'range') ?? cur.mode;
          }
          // FRVP-specific defaults
          if ('numBars' in patch || cur.numBars !== undefined) {
            updated.numBars = (p.numBars as number) ?? cur.numBars;
          }
          if ('pocColor' in patch || cur.pocColor !== undefined) {
            updated.pocColor = (p.pocColor as string) ?? cur.pocColor;
          }
          if ('showPoc' in patch || cur.showPoc !== undefined) {
            updated.showPoc = (p.showPoc as boolean) ?? cur.showPoc;
          }
          if ('extendPoc' in patch || cur.extendPoc !== undefined) {
            updated.extendPoc = (p.extendPoc as boolean) ?? cur.extendPoc;
          }
          if ('showBarValues' in patch || cur.showBarValues !== undefined) {
            updated.showBarValues = (p.showBarValues as boolean) ?? cur.showBarValues;
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
          ? [...s.drawingUndoStack, { type: 'remove', drawing }].slice(-50)
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
        drawingUndoStack: [...s.drawingUndoStack, { type: 'bulkRemove', drawings: removed }].slice(-50),
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
        drawingUndoStack: [...s.drawingUndoStack, { type: 'clear', drawings: s.drawings }].slice(-50),
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
