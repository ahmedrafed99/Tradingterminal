import type { Drawing, DrawingTool, HLineTemplate } from '../../types/drawing';

// ---------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------
type UndoEntry =
  | { type: 'add'; drawingId: string }
  | { type: 'update'; drawingId: string; previous: Partial<Drawing> }
  | { type: 'remove'; drawing: Drawing }
  | { type: 'clear'; drawings: Drawing[] };

interface DrawingStyleDefaults {
  color: string;
  strokeWidth: number;
}

export interface DrawingsState {
  activeTool: DrawingTool;
  drawingToolbarOpen: boolean;
  selectedDrawingId: string | null;
  drawings: Drawing[];
  drawingUndoStack: UndoEntry[];
  drawingDefaults: Record<string, DrawingStyleDefaults>;
  setActiveTool: (tool: DrawingTool) => void;
  setDrawingToolbarOpen: (open: boolean) => void;
  setSelectedDrawingId: (id: string | null) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>, skipUndo?: boolean) => void;
  removeDrawing: (id: string) => void;
  pushDrawingUndo: (entry: UndoEntry) => void;
  undoDrawing: () => void;
  clearAllDrawings: () => void;
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
  selectedDrawingId: null,
  drawings: [] as Drawing[],
  drawingUndoStack: [] as UndoEntry[],
  drawingDefaults: {} as Record<string, DrawingStyleDefaults>,
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

        if (existing && ('color' in patch || 'strokeWidth' in patch)) {
          const cur = s.drawingDefaults[existing.type] ?? { color: existing.color, strokeWidth: existing.strokeWidth };
          result.drawingDefaults = {
            ...s.drawingDefaults,
            [existing.type]: {
              color: (patch as { color?: string }).color ?? cur.color,
              strokeWidth: (patch as { strokeWidth?: number }).strokeWidth ?? cur.strokeWidth,
            },
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
        case 'clear':
          return {
            drawingUndoStack: stack,
            drawings: entry.drawings,
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
        selectedDrawingId: null,
        drawingUndoStack: [...s.drawingUndoStack, { type: 'clear', drawings: s.drawings }].slice(-50),
      };
    }),

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
