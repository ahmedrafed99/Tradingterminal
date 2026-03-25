# Drawing Tools Feature

Chart annotation system with horizontal line, rectangle, oval, arrow path, free draw, and ruler tools, floating edit toolbar, text labels, drag-to-move, hline templates (save/load/export/import), and localStorage persistence.

---

## Architecture

Uses the Lightweight Charts v5.1.0 built-in plugin system (`ISeriesPrimitive`) for canvas rendering:

```
UI Layer        DrawingToolbar (tool selection)
                DrawingEditToolbar (color, text, stroke, template, delete)
                    └── ColorPopover, TextPopover, StrokePopover, TemplatePopover

State Layer     Zustand DrawingsState slice (persisted to localStorage)
                    activeTool, drawings[], selectedDrawingIds[], drawingToolbarOpen
                Zustand HLineTemplatesState slice (persisted to localStorage)
                    hlineTemplates[]

Render Layer    DrawingsPrimitive (ISeriesPrimitive orchestrator)
                    ├── HLinePaneView → HLineRendererImpl
                    ├── RectPaneView → RectRendererImpl
                    ├── OvalPaneView → OvalRendererImpl
                    ├── ArrowPathPaneView → ArrowPathRendererImpl
                    ├── FreeDrawPaneView → FreeDrawRendererImpl
                    └── RulerDragPreviewRenderer (ephemeral measurement)

Hit Testing     hitTesting.ts (geometry utilities)
```

**Key LWC APIs:**
- `series.attachPrimitive(primitive)` — attaches custom drawing layer
- `updateAllViews()` — called automatically on viewport change
- `hitTest(x, y)` → returns `PrimitiveHoveredItem` with `externalId`
- `target.useMediaCoordinateSpace(({context, mediaSize}) => ...)` — canvas rendering in CSS pixel coords
- `series.priceToCoordinate(price)` for Y, `chart.timeScale().timeToCoordinate(time)` for X

---

## Files

### Types

| File | Purpose |
|------|---------|
| `frontend/src/types/drawing.ts` | Drawing, DrawingTool, DrawingText, HLineTemplate types + constants |

```ts
type DrawingTool = 'select' | 'hline' | 'rect' | 'oval' | 'arrowpath' | 'ruler' | 'freedraw';

interface DrawingText {
  content: string;
  color: string;
  fontSize: number;      // 8-32, from FONT_SIZE_OPTIONS
  bold: boolean;
  italic: boolean;
  hAlign: TextHAlign;    // 'left' | 'center' | 'right'
  vAlign: TextVAlign;    // 'top' | 'middle' | 'bottom'
}

interface DrawingBase {
  id: string;
  color: string;          // rgba (supports opacity)
  strokeWidth: number;    // 1-4
  text: DrawingText | null;
  contractId: string;     // scope per instrument
}

interface HLineDrawing extends DrawingBase {
  type: 'hline';
  price: number;
  startTime: number;      // timestamp where the line was placed
  extendLeft: boolean;    // true = full width, false = starts at startTime going right
}

interface AnchoredPoint {
  time: number;           // snapped bar time (backward compat)
  price: number;
  anchorTime?: number;    // nearest bar time (sub-bar precision)
  barOffset?: number;     // fractional bar offset from anchorTime
}

interface RectDrawing extends DrawingBase {
  type: 'rect';
  p1: AnchoredPoint;     // diagonal corner 1
  p2: AnchoredPoint;     // diagonal corner 2
  fillColor: string;     // rgba fill (supports opacity)
}

interface OvalDrawing extends DrawingBase {
  type: 'oval';
  p1: AnchoredPoint;     // bounding rect corner 1
  p2: AnchoredPoint;     // bounding rect corner 2
  fillColor: string;     // rgba fill (supports opacity)
}

interface ArrowPathDrawing extends DrawingBase {
  type: 'arrowpath';
  anchorTime: number;  // time of nearest bar to first point (for pan positioning)
  points: { barOffset: number; price: number }[];  // barOffset = fractional bars from anchor
}

interface FreeDrawDrawing extends DrawingBase {
  type: 'freedraw';
  anchorTime: number;  // time of nearest bar to first point
  points: { barOffset: number; price: number }[];  // continuous brush stroke
}

type Drawing = HLineDrawing | RectDrawing | OvalDrawing | ArrowPathDrawing | RulerDrawing | FreeDrawDrawing;

interface HLineTemplate {
  id: string;
  name: string;
  color: string;
  strokeWidth: number;
  text: DrawingText | null;
}
```

Constants: `DEFAULT_HLINE_COLOR = '#787b86'`, `DEFAULT_RECT_COLOR = '#ff9800'`, `DEFAULT_RECT_FILL = 'rgba(255, 152, 0, 0.15)'`, `DEFAULT_OVAL_COLOR = '#ff9800'`, `DEFAULT_OVAL_FILL = 'rgba(255, 152, 0, 0.15)'`, `DEFAULT_ARROWPATH_COLOR = '#f7c948'`, `DEFAULT_RULER_COLOR = '#2962ff'`, `DEFAULT_FREEDRAW_COLOR = '#ffffff'`, `STROKE_WIDTH_OPTIONS = [1, 2, 3, 4]`, `FONT_SIZE_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32]`

### UI Components

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/components/chart/DrawingToolbar.tsx` | ~180 | Collapsible left-edge sidebar (hline, rect, oval, arrowpath, ruler, freedraw) — rendered once in `ChartArea`, not per chart |
| `frontend/src/components/chart/DrawingEditToolbar.tsx` | ~680 | Floating edit popup with color, text, stroke, template, delete — scoped per chart via `contractId` prop |

### Primitive Renderers

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/components/chart/drawings/DrawingsPrimitive.ts` | ~930 | ISeriesPrimitive orchestrator — manages all drawing views + previews |
| `frontend/src/components/chart/drawings/HLineRenderer.ts` | ~187 | Horizontal line renderer + hit test |
| `frontend/src/components/chart/drawings/RectRenderer.ts` | ~180 | Rectangle renderer with fill + stroke, 4 corner handles, edge hit test |
| `frontend/src/components/chart/drawings/OvalRenderer.ts` | ~197 | Oval/ellipse renderer + 4-handle resize + hit test |
| `frontend/src/components/chart/drawings/ArrowPathRenderer.ts` | ~200 | Arrow path polyline renderer + node drag + hit test |
| `frontend/src/components/chart/drawings/FreeDrawRenderer.ts` | ~110 | Free draw brush stroke renderer + start/end handles + hit test |
| `frontend/src/components/chart/drawings/RulerRenderer.ts` | ~230 | Ruler measurement renderer (used for persisted rulers) |
| `frontend/src/components/chart/drawings/rulerMetrics.ts` | ~80 | Ruler metrics computation (price change, %, bars, time, volume) |
| `frontend/src/components/chart/drawings/hitTesting.ts` | ~79 | Geometry hit-test utilities (hline, arrowpath/freedraw, rect, oval) |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/store/slices/drawingsSlice.ts` | DrawingsState slice + HLineTemplatesState slice |
| `frontend/src/components/chart/ChartArea.tsx` | Renders single `DrawingToolbar` on left edge of chart area |
| `frontend/src/components/chart/CandlestickChart.tsx` | Primitive attachment, click/drag handlers, keyboard shortcuts, edit toolbar rendering |

---

## Store Slice

```ts
interface DrawingsState {
  activeTool: DrawingTool;           // ephemeral, default 'select'
  drawingToolbarOpen: boolean;       // persisted
  selectedDrawingIds: string[];      // ephemeral — empty=none, single=edit toolbar, multi=bulk toolbar
  drawings: Drawing[];               // persisted
  drawingDefaults: Record<string, DrawingStyleDefaults>; // persisted — per-tool color/stroke/fill defaults
  drawingUndoStack: UndoEntry[];     // ephemeral — max 50 entries

  setActiveTool: (tool: DrawingTool) => void;     // also clears selection
  setDrawingToolbarOpen: (open: boolean) => void;
  setSelectedDrawingIds: (ids: string[]) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>, skipUndo?: boolean) => void;
  removeDrawing: (id: string) => void;             // also filters from selectedDrawingIds
  removeDrawings: (ids: string[]) => void;         // bulk delete, single 'bulkRemove' undo entry
  clearAllDrawings: () => void;                    // removes all drawings, undoable via Ctrl+Z
  pushDrawingUndo: (entry: UndoEntry) => void;
  undoDrawing: () => void;                         // Ctrl+Z — pops last entry and reverses it
}

// UndoEntry types: 'add' | 'update' | 'remove' | 'clear' | 'bulkRemove'
// Each stores the previous state needed to reverse the operation.

interface HLineTemplatesState {
  hlineTemplates: HLineTemplate[];   // persisted
  addHLineTemplate: (template: HLineTemplate) => void;
  removeHLineTemplate: (id: string) => void;
}
```

Persisted to localStorage: `drawings`, `drawingToolbarOpen`, `drawingDefaults`, `hlineTemplates`, `customColors`.

### drawingDefaults

Per-type sticky style defaults (`Record<string, { color: string; strokeWidth: number }>`). When a user edits a drawing's color or strokeWidth via the edit toolbar, the new values are saved as defaults for that drawing type. The next drawing of the same type will use the last-used color and strokeWidth instead of the hardcoded constants. Persisted to both localStorage and the backend settings file.

---

## Components

### DrawingToolbar

Collapsible vertical toolbar on the left edge of the chart area (`z-30`, `bottom: 10%`). Rendered once in `ChartArea.tsx` (not per chart) — the single toolbar controls drawing on whichever chart the user interacts with.

**Toggle button**: Orange chevron button always visible at the bottom. Click to expand/collapse. Chevron rotates (right → down) with a 150ms transition to indicate state. Tool buttons expand **upward** above the toggle button.

**Right-click on chart**: Cancels the active drawing tool (switches back to select). Also suppresses browser context menu on the chart.

All icons are TradingView-style filled SVGs (28×28 viewBox scaled to 22×22) with `shapeRendering="geometricPrecision"` for crisp sub-pixel rendering. Button containers are 36×34.

| Tool | Icon | Behavior |
|------|------|----------|
| Horizontal Line | Ray with endpoint handle | Click on chart to place at price level |
| Rectangle | Rect outline with 4 corner handles | Click to place first corner, move mouse, click to place diagonal corner |
| Oval | Dashed ellipse with 4 cardinal handles | Click-and-drag to define bounding rectangle |
| Arrow Path | Zigzag trend line with node dots and arrowhead | Click to place nodes, double-click to finalize (right-click also works) |
| Ruler | Rotated ruler with tick marks | Click to start, move, click to finish — ephemeral measurement overlay |
| Free Draw | Brush with paint blob | Click-and-drag to draw freehand brush strokes. Tool stays active after each stroke for consecutive drawing. |
| Delete All | Trash can with lid | Removes all drawings from all charts. Always visible; greyed out (disabled) when no drawings exist. Separated by a divider. Undoable via Ctrl+Z. |

### DrawingEditToolbar

Floating toolbar positioned above the selected drawing, rendered per chart instance inside `CandlestickChart.tsx`. Each instance receives a `contractId` prop and only displays when the selected drawing's `contractId` matches — this prevents the popover from appearing on both charts in dual mode. Dark theme (`#1e222d` background, `#2a2e39` border, 8px border-radius, `0 4px 16px` shadow).

**Layout:** `[ Pencil+color | Fill bucket | T ] | [ ─ 2px ] | [ Extend toggle ] | [ Template v ] | [ Trash ]`

All icons use TradingView-style filled SVGs with `shapeRendering="geometricPrecision"` (14×14 pencil, 16×16 bucket, 11×13 T, 22×22 extend/trash). Template button only shown for hline drawings. Fill color button (bucket icon) shown for rect and oval drawings. Extend toggle (hline only) swaps between two icons: ray with center handle (not extended) ↔ hline with left endpoint handle (extended).

- Vertical dividers between logical groups
- 32x32px button targets with 6px border-radius
- Hover: `#363a45` background, lighter text. Active: same but persistent
- Delete: turns red (`#f44336`) on hover

**Sub-popovers:**

1. **ColorPopover** (252px wide): 8×10 color palette grid (grayscale → deepest tones) + persistent custom colors row, custom color via "+" button. Always includes an opacity slider (0-100%) — taller track (16px) with panel-colored background, color gradient overlay, 18px draggable thumb (pointer-events: none for smooth dragging), and editable number input. All colors are emitted as rgba strings.
2. **TextPopover** (290px wide, `bg: #000`) — **live preview**: all changes (color, font size, bold, italic, alignment, content) are applied to the drawing in real-time as you edit. Original text state is snapshotted on open; Cancel restores it, Ok confirms.
   - Row 1: Color swatch (22x22, toggles palette with animated slide) + font size select + **B** bold + *I* italic toggle buttons (active: `#f0a830` text + `#111` bg + `#434651` border, inactive: `#787b86` text with hover highlight, 0.15s transitions)
   - Color grid: animated expand/collapse (`max-height` + `opacity` transition) with opacity slider
   - Row 2: Multiline textarea (`bg: var(--color-panel)`, `text: #d1d4dc`, `border: #2a2e39`, system-ui font, resize disabled)
   - Row 3: "TEXT POSITION" section label + visual 3×3 dot grid widget (80% width, centered) with a horizontal line across the middle row. Active position shown as larger colored dot with border; inactive as small dim dots. Click any of the 9 positions to set vAlign (top/middle/bottom) × hAlign (left/center/right)
   - Row 4: Cancel (`bg: #1e222d`, hover `#363a45`) / Ok (`bg: #1a3a6e`, hover `#1e4a8a`) buttons
3. **StrokePopover** (120px wide, centered): visual line thickness previews for 1-4px
4. **TemplatePopover** (220px wide, hline only): saved style templates with export/import

**Positioning:** Computed from drawing coordinates via `series.priceToCoordinate()` and `chart.timeScale().timeToCoordinate()`. Repositions on viewport changes via `subscribeVisibleLogicalRangeChange`.

---

## Primitive Rendering

### DrawingsPrimitive (orchestrator)

Implements `ISeriesPrimitive<Time>`. Manages an array of `HLinePaneView | RectPaneView | OvalPaneView | ArrowPathPaneView | RulerPaneView | FreeDrawPaneView`.

Key methods:
- `setDrawings(drawings, selectedIds)` — rebuilds views, calls `requestUpdate()`
- `setDragPreview(x1, y1, x2, y2, fillColor?)` / `clearDragPreview()` — ellipse preview with fill + cardinal handles during oval creation
- `setRectPreview(x1, y1, x2, y2)` / `clearRectPreview()` — rect preview with corner handles during rect creation (uses `useBitmapCoordinateSpace` with pixel-snapped strokes to match finalized rendering)
- `setArrowPathPreview(points)` / `clearArrowPathPreview()` — polyline preview with node handles during arrow path creation
- `setFreeDrawPreview(points, color, strokeWidth)` / `clearFreeDrawPreview()` — live brush stroke during free draw creation
- `setRulerDragPreview(x1, y1, x2, y2, metrics, decimals)` / `clearRulerDragPreview()` — ruler rectangle + label preview
- `getHandleAt(x, y)` — hit-test resize handles on selected rect/oval/ruler
- `hitTest(x, y)` — returns `PrimitiveHoveredItem` with `externalId` for click-to-select
- `setSelectionRect(x1, y1, x2, y2)` / `clearSelectionRect()` — dashed blue rectangle during Ctrl+drag multi-select
- `getDrawingsInRect(x1, y1, x2, y2)` — returns IDs of drawings whose bounding box overlaps the rectangle (AABB overlap)
- `priceAxisViews()` — returns price axis labels for all HLines with **de-overlap stacking**: labels are sorted by Y coordinate and pushed apart (18px gap) so close HLines stack vertically instead of overlapping

### HLineRenderer

Draws a full-width horizontal line at the drawing's price level.

- Stroke: `drawing.color`, `drawing.strokeWidth`
- Selected: 3 small handle squares (left edge, center, right edge)
- Text label: positioned by `hAlign` (left=8px, center=mid, right=width-8) and `vAlign` (top/middle/bottom relative to line). When `vAlign` is `middle`, the line is split into two segments with a gap around the text (4px padding each side) so the line does not cut through the letters.
- Font: `system-ui, -apple-system, sans-serif` with configurable size/bold/italic
- Hit test: `|mouseY - lineY| <= 5px`, excludes price scale area (`mouseX >= timeScale.width()`)

### RectRenderer

Draws a rectangle defined by two diagonal corners (p1, p2). Uses `useBitmapCoordinateSpace` for device-pixel rendering.

- Fill: `drawing.fillColor` (rgba with opacity support), raw coordinates for full coverage
- Stroke: `drawing.color`, `drawing.strokeWidth` (1 = 1 device pixel). Stroke coordinates are snapped to pixel grid (`Math.round() + 0.5`) for crisp lines — prevents anti-aliasing from blurring 1px strokes across 2 device pixels
- Selected: 4 circular corner handles (nw, ne, sw, se) — same white fill + color stroke style as path nodes
- Text label: positioned relative to rectangle edges
- Hit test: proximity to any of the 4 edges via `hitTestRectEdges()` (6px tolerance)
- Resize handles: 4 corner positions (nw/ne/sw/se) with 6px hit tolerance — dragging a corner moves it freely while the diagonally opposite corner stays fixed
- Creation: click-click flow (first click = p1, mouse moves with dashed preview, second click = p2)
- **Smooth rendering**: uses `AnchoredPoint` with `anchorTime` + `barOffset` for sub-bar precision — corners stay exactly where placed instead of snapping to bar centers

### OvalRenderer

Draws an ellipse inscribed in the bounding rectangle defined by p1 and p2.

- Fill: `drawing.fillColor` (rgba with opacity support)
- `ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*PI)` + fill + stroke
- Selected: 4 circular handles (white fill, oval color stroke) at cardinal points (top, bottom, left, right)
- Text label: positioned relative to ellipse center and radii
- Hit test: normalized ellipse distance check `|d - 1.0| < tolerance / min(rx, ry)`
- Resize handles: 4 positions (n, s, w, e) with 6px hit tolerance — cardinal handles are axis-constrained (n/s move only vertically, w/e move only horizontally)
- **Smooth rendering**: same `AnchoredPoint` approach as rect — no horizontal snapping to bar centers

---

## Interactions (in CandlestickChart.tsx)

All drawing interactions are in the first `useEffect` (drawings effect). Event handlers are registered on the chart container with priority ordering.

### Event listener priority

```
1. onOverlayHitTest       — overlay label hit testing (order lines, position lines)
2. onCtrlDragSelectDown   — Ctrl+drag area selection for multi-select
3. onResizeMouseDown      — resize handles on selected rect/oval/ruler (most specific)
4. onDrawingDragMouseDown — drag-to-move any drawing
5. onRectMouseDown        — rect creation when tool is 'rect'
6. onOvalMouseDown        — oval creation when tool is 'oval'
7. onFreeDrawMouseDown    — free draw creation when tool is 'freedraw'
```

Overlay hit testing is first so order/position line drags take priority over drawing interactions when they overlap. It uses `stopImmediatePropagation()` to prevent subsequent drawing handlers from firing on the same mousedown event.

Plus shared `mousemove` and `mouseup` on `window` for all interactions. Arrow path, rect, and ruler use click-based state machines in `onMouseUp`.

### Horizontal line placement

- Tool: `hline`
- Click on chart → `series.coordinateToPrice(y)` → `addDrawing({type:'hline', price, ...})`
- Auto-switches to select tool after placement and auto-selects the new drawing (edit toolbar appears immediately)

### Rectangle creation (two modes)

- Tool: `rect`
- **Click-move-click**: `mousedown` records p1 (start corner) and disables chart scroll. `mouseup` with <5px movement keeps creation active. Mouse move shows live preview (solid fill + stroke matching defaults). Next `mouseup` with >5px movement from p1 finalizes.
- **Click-drag-release**: `mousedown` records p1. Drag shows live preview. `mouseup` with >5px movement finalizes immediately.
- Both modes: preview uses saved style defaults (border color, fill color, stroke width). Escape or right-click cancels in-progress creation.
- Sticky defaults: border color, stroke width, and fill color (including opacity) are remembered across drawings via `drawingDefaults['rect']`
- Default fill: `rgba(255, 152, 0, 0.15)` (orange at 15% opacity), default stroke: `#ff9800`
- Auto-selects the new drawing after creation (edit toolbar appears immediately)
- Edit toolbar shows: border color picker, fill color picker with opacity slider, text, stroke width, delete

### Oval creation (drag-to-create)

- Tool: `oval`
- `mousedown` records start point, disables chart scroll
- `mousemove` shows live ellipse preview via `primitive.setDragPreview()` (includes fill color from defaults)
- `mouseup` creates oval if drag distance > 5px, switches to select tool and auto-selects the new drawing
- Minimum drag threshold prevents accidental creation on clicks
- Sticky defaults: stroke color, stroke width, and fill color (including opacity) are remembered across ovals via `drawingDefaults['oval']`
- Default fill: `rgba(255, 152, 0, 0.15)` (orange at 15% opacity), default stroke: `#ff9800`
- Edit toolbar shows: border color picker, fill color picker with opacity slider, text, stroke width, delete

### Arrow path creation (click-to-place nodes)

- Tool: `arrowpath`
- Click to place polyline nodes (each click adds a point)
- Live preview line follows cursor from last placed node
- Double-click finalizes the path (deduplicates the last point to preserve arrowhead, creates drawing if >= 2 points)
- Right-click also finalizes (adds final point at cursor, creates drawing if >= 2 points)
- **Ctrl = horizontal snap**: holding Ctrl locks Y to the last placed node's Y, forcing horizontal segments (applies to preview, node placement, and right-click finalize)
- Escape cancels creation
- Arrow tip drawn at the last point
- Auto-selects the new drawing after creation (edit toolbar appears immediately)
- **Smooth rendering**: uses `anchorTime` + fractional `barOffset` (same approach as free draw) so nodes can be placed between candle bars without snapping

### Free draw (drag-to-draw)

- Tool: `freedraw`
- `mousedown` records anchor bar time, bar spacing, and first point; disables chart scroll; shows live CSS preview
- `mousemove` adds points (3px minimum distance between points to avoid over-sampling); updates preview in real-time
- `mouseup` finalizes the stroke as a `FreeDrawDrawing` with `anchorTime` + `barOffset/price` points
- **Tool stays active** after each stroke so the user can draw multiple consecutive strokes without re-selecting
- **Ctrl = horizontal snap**: holding Ctrl while drawing locks Y to the last point's Y, forcing a perfectly horizontal continuation from the current position
- Escape or right-click cancels in-progress stroke
- **Smooth rendering**: uses `anchorTime` + fractional `barOffset` (pixel distance / bar spacing) instead of `coordinateToTime()` which snaps to discrete bar positions. On render: `pixelX = timeToCoordinate(anchorTime) + barOffset * currentBarSpacing`
- **Stroke rendering**: `strokeWidth` is used directly in bitmap coordinate space (1 = 1 device pixel, the thinnest possible line) — not scaled by pixel ratio
- Selected state shows start and end node handles (`COLOR_LABEL_TEXT` fill, `COLOR_HANDLE_STROKE` border — same style as arrow path)
- Edit toolbar shows only color + stroke width (no text, template, or extend controls)

### Ruler measurement (click-move-click, ephemeral)

- Tool: `ruler` (or **hold Shift** to temporarily activate ruler from select mode)
- First click sets the start point, disables chart scroll
- Mouse move shows live preview: semi-transparent rectangle fill + metrics label (price change, %, bar count, time span, volume)
- Second click finalizes — preview stays visible, tool switches to select
- **Shift hold shortcut**: Hold Shift to temporarily activate the ruler tool (toolbar highlights ruler). Use normal click-move-click to measure. One-shot behavior: after completing a measurement, the ruler tool deselects even if Shift is still held. You must release and re-press Shift to draw another ruler. Releasing Shift (without having drawn) restores the select tool. **Ignored when focus is inside an input, textarea, or contentEditable element** (e.g., typing in the edit toolbar's text popover) so that Shift for uppercase doesn't hijack the tool.
- **Ephemeral**: ruler is NOT persisted to the store. Next left-click or Escape dismisses the overlay
- **Directional arrows**: two single-direction crossing arrows rendered inside the rectangle at 0.5 alpha (lighter than the 0.25 fill). Vertical arrow points up for positive (price increase) or down for negative (price decrease). Horizontal arrow always points right (time direction). Arrows span the full rectangle edges. Only drawn when the rectangle is large enough (>15px per axis).
- Negative rulers (price went down): stronger red rectangle (`#d32f2f` at 0.25 alpha), darker red label (`#8b2232` at 0.85 alpha)
- Positive rulers: blue rectangle and label (`#2962ff`)
- Metrics computed via `computeRulerMetrics(bars, p1, p2)` from `rulerMetrics.ts`

### Click-to-select

- `chart.subscribeClick()` handler
- If `hoveredObjectId` from `hitTest()` → `setSelectedDrawingIds([id])`
- If no hovered object → `setSelectedDrawingIds([])` (deselect)

### Multi-select (Ctrl+drag area selection)

- Tool: `select`, requires `Ctrl` key held
- `mousedown` with Ctrl → records start point, disables chart pan/scroll
- `mousemove` → renders dashed blue selection rectangle via `primitive.setSelectionRect()` (semi-transparent `rgba(41, 98, 255, 0.08)` fill + dashed `rgba(41, 98, 255, 0.6)` border)
- `mouseup` → calls `primitive.getDrawingsInRect()` which checks AABB overlap of each drawing's `getBoundingBox()` against the selection rectangle → sets `selectedDrawingIds` with all matched IDs
- Each PaneView provides `getBoundingBox()`: HLine uses price ± 5px tolerance × chart width, Oval/Ruler use their p1/p2 screen coords, ArrowPath/FreeDraw compute min/max of all CSS pixel points
- When multiple drawings are selected:
  - A simplified edit toolbar appears showing "{N} selected" + Delete button
  - Delete/Backspace key bulk-deletes all selected drawings (single `bulkRemove` undo entry)
  - Ctrl+Z undoes the bulk delete, restoring all removed drawings
- Escape cancels in-progress Ctrl+drag or clears multi-selection
- Clicking empty space or a single drawing resets to single/no selection

### Drag-to-move

- Tool: `select`
- `mousedown` on drawing body → records original position, disables chart scroll
- 3px movement threshold distinguishes click from drag
- **hline**: `coordinateToPrice(mouseY)` → `updateDrawing(id, { price })`
- **hline crosshair suppression**: during hline drag, both `CrosshairLabelPrimitive.suppress(true)` and `chart.applyOptions({ crosshair: { horzLine: { labelVisible: false } } })` hide the crosshair price labels (HTML overlay + native LWC). The HTML overlay updates instantly while the drawing label (canvas) renders one frame later via the LWC paint cycle — showing both causes a visible 1-frame lag flicker. The native LWC label is also hidden because it normally sits behind the HTML overlay and would peek through when de-overlap pushes the drawing label away from another drawing. Both restored on mouseup.
- **rect/oval**: compute time/price delta from start → shift both p1 and p2 by same offset
- `mouseup` clears drag state, re-enables chart scroll
- `drawingDragOccurred` flag suppresses the `subscribeClick` that follows mouseup

### Rect / Oval resize

- Only when rect or oval is selected (select tool active)
- `mousedown` on a resize handle → records fixed opposite corner + original moving corner + handle type
- Rect/Ruler: 4 corner handles (nw/ne/sw/se) — both axes follow mouse freely
- Oval: 4 cardinal handles (n/s/e/w) — axis-constrained: `n`/`s` only change price (vertical), `w`/`e` only change time (horizontal)
- Uses data coordinates (time/price) for stable resize during viewport changes

### Keyboard shortcuts

Shortcuts are **configurable** via Settings → Shortcuts tab. Stored in `customShortcuts` (Zustand, persisted to localStorage). Defaults shown below.

Registry: `frontend/src/constants/shortcuts.ts` — central `SHORTCUT_DEFS` array with `KeyCombo` types, `matchesShortcut()` helper, `formatKeyCombo()` display formatter.

| Key | Action | Configurable |
|-----|--------|:---:|
| `Escape` | Cancel Ctrl+drag selection → cancel in-progress drag → cancel resize → cancel tool → clear selection → deselect | Yes |
| `Delete` / `Backspace` | Remove selected drawing(s) — single or bulk delete (guarded: not in input/textarea) | Yes |
| `Ctrl+Z` / `Cmd+Z` | Undo last drawing mutation including bulk deletes | Yes |
| `Ctrl+Drag` | Multi-select drawings via area selection | No |
| `Ctrl+Hold` | Horizontal snap for free draw / arrow path | No |
| `Shift` (hold) | Quick ruler — activates ruler tool while held, restores select on release | No |

### Cursor management

- Drawing tool active (`hline`/`rect`/`oval`/`arrowpath`/`ruler`/`freedraw`): `crosshair`
- Select tool: `none` (default — hides cursor over chart)
- Hovering resize handle: directional resize cursor mapped to handle position (`nw-resize`, `ne-resize`, `sw-resize`, `se-resize` for rect/ruler corners; `n-resize`, `s-resize`, `w-resize`, `e-resize` for oval cardinal handles; `grab` fallback for arrow path nodes)
- During drag: `grabbing` cursor

---

## Data Flow

```
User clicks tool → store.setActiveTool('hline')
                  → DrawingToolbar highlights active
                  → CandlestickChart cursor changes to crosshair

User clicks chart → handleClick fires
                  → series.coordinateToPrice(y) → price
                  → store.addDrawing({type:'hline', price, ...})
                  → store subscriber fires → primitive.setDrawings(filtered, selectedId)
                  → primitive rebuilds pane views → requestUpdate()
                  → LWC redraws → HLineRenderer.draw() renders line

User clicks drawing → hitTest returns externalId
                    → store.setSelectedDrawingIds([id])
                    → DrawingEditToolbar appears above drawing
                    → primitive.setDrawings() marks it selected → handles appear

User Ctrl+drags    → selection rectangle rendered on canvas
                   → mouseup → getDrawingsInRect() → setSelectedDrawingIds(ids)
                   → DrawingEditToolbar shows simplified "{N} selected" + Delete

User edits in toolbar → store.updateDrawing(id, patch)
                      → subscriber → primitive.setDrawings() → requestUpdate() → redraw
                      → also persisted to localStorage
```

---

## HLine Templates

Saved style presets for horizontal lines. Stores color, strokeWidth, and text config so users can quickly apply consistent styles across drawings.

### TemplatePopover

Dropdown popover (220px wide, `maxHeight: 300`, `overflowY: auto`) attached to the "Template" button in the edit toolbar. Only rendered when `drawing.type === 'hline'`.

**Layout (top to bottom):**

1. **Saved templates list**: each row shows `[color dot] [stroke preview] [name] [bin delete]`
   - Click row → applies template's color, strokeWidth, text to the selected drawing
   - Delete button (bin/trash icon) appears on hover via `group-hover:opacity-100`
2. **Divider** (if templates exist)
3. **"Save as..."** button → toggles inline save form:
   - Text input (auto-focused) + muted blue "Save" button (`#1a3a6e`, hover `#1e4a8a`)
   - **Autocomplete suggestions**: as you type, a dropdown shows existing templates whose names match the input (case-insensitive substring). Clicking a suggestion fills the name field — saving with an existing name overrides that template.
   - Enter to save, Escape to cancel
   - Saves current drawing's color, strokeWidth, and text as a new template with `crypto.randomUUID()` ID. If a template with the same name already exists (case-insensitive), it is removed first (override).
4. **"Apply defaults"** button → resets drawing to `DEFAULT_HLINE_COLOR` (#787b86), strokeWidth 1, no text
5. **Divider**
6. **Export / Import** row (each with icon: upload arrow for export, download arrow for import):
   - **Export**: downloads all templates as `hline-templates.json` (disabled when no templates)
   - **Import**: hidden `<input type="file" accept=".json">`, parses JSON array, validates each entry has `name`, `color`, `strokeWidth`, assigns fresh UUIDs

### Export format

```json
[
  {
    "id": "...",
    "name": "Support Level",
    "color": "#ff4d4f",
    "strokeWidth": 2,
    "text": {
      "content": "Support",
      "color": "#ff4d4f",
      "fontSize": 12,
      "bold": true,
      "italic": false,
      "hAlign": "left",
      "vAlign": "top"
    }
  }
]
```

On import, each template's `id` is replaced with a fresh `crypto.randomUUID()` to avoid conflicts. Malformed JSON is silently ignored.

---

## Marker Drawing

Arrow + pill label marker that anchors to a candle's high or low. Used by the remote drawing API (`POST /drawings/add` with `type: 'marker'`) and internally by `TradeZonePrimitive` for trade entry/exit labels.

### Type

```ts
interface MarkerDrawing extends DrawingBase {
  type: 'marker';
  time: number;                    // bar timestamp (unix seconds)
  price: number;                   // price level (used as fallback if bar data unavailable)
  label: string;                   // text inside the pill (e.g. "Entry  1 @ 21300.00")
  placement: 'above' | 'below';   // arrow direction relative to candle
}
```

### Rendering

- `placement: 'below'` → arrow anchors to candle **low**, points upward into the candle
- `placement: 'above'` → arrow anchors to candle **high**, points downward into the candle
- Falls back to `price` if the candle bar data isn't available at the given `time`
- Label rendered as white text with dark outline for contrast (no background pill)

### Files

| File | Purpose |
|------|---------|
| `frontend/src/components/chart/drawings/markerLabel.ts` | Shared `drawMarkerLabel()` utility — arrow + pill rendering in bitmap coords |
| `frontend/src/components/chart/drawings/MarkerRenderer.ts` | `MarkerPaneView` — looks up candle high/low for anchor, delegates to `drawMarkerLabel()` |
| `frontend/src/components/chart/TradeZonePrimitive.ts` | Refactored to use `drawMarkerLabel()` for entry/exit labels |

---

## Persistence

Drawings and hline templates are persisted to localStorage via Zustand's `persist` middleware (key: `chart-store`). The `partialize` function includes `drawings`, `drawingToolbarOpen`, and `hlineTemplates`.

Each drawing stores a `contractId` to scope it per instrument. When rendering, drawings are filtered: `drawings.filter(d => d.contractId === String(contract.id))`.

---

## Color Palette

Both the color picker and text color picker use the same 8×10 grid:

| Row | Theme |
|-----|-------|
| 1 | Grayscale (#f2f2f2 → #000000) |
| 2 | Bright (#ff4d4f, #ffa500, #ffd84d, ...) |
| 3 | Light pastels |
| 4 | Soft tones |
| 5 | Medium tones |
| 6 | Strong tones |
| 7 | Dark tones |
| 8 | Deepest tones |

**Custom colors:** The "+" button opens a native `<input type="color">` picker. Chosen colors are saved to a persistent custom colors row (displayed between the palette grid and the "+" button). Custom colors are stored in the Zustand store (`customColors: string[]`) and persisted to localStorage. Duplicate colors are deduplicated (moved to end). Each custom swatch shows a "×" delete button on hover.
