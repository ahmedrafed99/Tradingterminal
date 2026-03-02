# Drawing Tools Feature

Chart annotation system with horizontal line, oval, arrow path, and ruler tools, floating edit toolbar, text labels, drag-to-move, hline templates (save/load/export/import), and localStorage persistence.

---

## Architecture

Uses the Lightweight Charts v5.1.0 built-in plugin system (`ISeriesPrimitive`) for canvas rendering:

```
UI Layer        DrawingToolbar (tool selection)
                DrawingEditToolbar (color, text, stroke, template, delete)
                    └── ColorPopover, TextPopover, StrokePopover, TemplatePopover

State Layer     Zustand DrawingsState slice (persisted to localStorage)
                    activeTool, drawings[], selectedDrawingId, drawingToolbarOpen
                Zustand HLineTemplatesState slice (persisted to localStorage)
                    hlineTemplates[]

Render Layer    DrawingsPrimitive (ISeriesPrimitive orchestrator)
                    ├── HLinePaneView → HLineRendererImpl
                    ├── OvalPaneView → OvalRendererImpl
                    ├── ArrowPathPaneView → ArrowPathRendererImpl
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
type DrawingTool = 'select' | 'hline' | 'oval' | 'arrowpath' | 'ruler';

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
  color: string;          // hex
  strokeWidth: number;    // 1-4
  text: DrawingText | null;
  contractId: string;     // scope per instrument
}

interface HLineDrawing extends DrawingBase {
  type: 'hline';
  price: number;
}

interface OvalDrawing extends DrawingBase {
  type: 'oval';
  p1: { time: number; price: number };  // bounding rect corner 1
  p2: { time: number; price: number };  // bounding rect corner 2
}

interface ArrowPathDrawing extends DrawingBase {
  type: 'arrowpath';
  points: { time: number; price: number }[];  // polyline nodes
}

type Drawing = HLineDrawing | OvalDrawing | ArrowPathDrawing;

interface HLineTemplate {
  id: string;
  name: string;
  color: string;
  strokeWidth: number;
  text: DrawingText | null;
}
```

Constants: `DEFAULT_HLINE_COLOR = '#787b86'`, `DEFAULT_OVAL_COLOR = '#ff9800'`, `DEFAULT_ARROWPATH_COLOR = '#ff9800'`, `DEFAULT_RULER_COLOR = '#2962ff'`, `STROKE_WIDTH_OPTIONS = [1, 2, 3, 4]`, `FONT_SIZE_OPTIONS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32]`

### UI Components

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/components/chart/DrawingToolbar.tsx` | ~140 | Collapsible left-edge sidebar (select, hline, oval, arrowpath, ruler) — rendered once in `ChartArea`, not per chart |
| `frontend/src/components/chart/DrawingEditToolbar.tsx` | ~680 | Floating edit popup with color, text, stroke, template, delete — scoped per chart via `contractId` prop |

### Primitive Renderers

| File | Lines | Purpose |
|------|-------|---------|
| `frontend/src/components/chart/drawings/DrawingsPrimitive.ts` | ~320 | ISeriesPrimitive orchestrator — manages all drawing views + ruler preview |
| `frontend/src/components/chart/drawings/HLineRenderer.ts` | ~114 | Horizontal line renderer + hit test |
| `frontend/src/components/chart/drawings/OvalRenderer.ts` | ~197 | Oval/ellipse renderer + 8-handle resize + hit test |
| `frontend/src/components/chart/drawings/ArrowPathRenderer.ts` | ~200 | Arrow path polyline renderer + node drag + hit test |
| `frontend/src/components/chart/drawings/RulerRenderer.ts` | ~230 | Ruler measurement renderer (used for persisted rulers) |
| `frontend/src/components/chart/drawings/rulerMetrics.ts` | ~80 | Ruler metrics computation (price change, %, bars, time, volume) |
| `frontend/src/components/chart/drawings/hitTesting.ts` | ~79 | Geometry hit-test utilities (hline, arrowpath, rect, oval) |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/store/useStore.ts` | DrawingsState slice + HLineTemplatesState slice |
| `frontend/src/components/chart/ChartArea.tsx` | Renders single `DrawingToolbar` on left edge of chart area |
| `frontend/src/components/chart/CandlestickChart.tsx` | Primitive attachment, click/drag handlers, keyboard shortcuts, edit toolbar rendering |

---

## Store Slice

```ts
interface DrawingsState {
  activeTool: DrawingTool;           // ephemeral, default 'select'
  drawingToolbarOpen: boolean;       // persisted
  selectedDrawingId: string | null;  // ephemeral
  drawings: Drawing[];               // persisted

  setActiveTool: (tool: DrawingTool) => void;     // also clears selection
  setDrawingToolbarOpen: (open: boolean) => void;
  setSelectedDrawingId: (id: string | null) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;             // also clears selection if removed
}

interface HLineTemplatesState {
  hlineTemplates: HLineTemplate[];   // persisted
  addHLineTemplate: (template: HLineTemplate) => void;
  removeHLineTemplate: (id: string) => void;
}
```

Persisted to localStorage: `drawings`, `drawingToolbarOpen`, `hlineTemplates`.

---

## Components

### DrawingToolbar

Collapsible vertical toolbar on the left edge of the chart area (`z-30`, `bottom: 10%`). Rendered once in `ChartArea.tsx` (not per chart) — the single toolbar controls drawing on whichever chart the user interacts with.

**Toggle button**: Orange chevron button always visible at the bottom. Click to expand/collapse. Chevron rotates (right → down) with a 150ms transition to indicate state. Tool buttons expand **upward** above the toggle button.

**Right-click on chart**: Cancels the active drawing tool (switches back to select). Also suppresses browser context menu on the chart.

| Tool | Icon | Behavior |
|------|------|----------|
| Select (cursor) | Arrow pointer | Click drawings to select, drag to move |
| Horizontal Line | Line with endpoint dots | Click on chart to place at price level |
| Oval | Ellipse | Click-and-drag to define bounding rectangle |
| Arrow Path | Polyline with arrow | Click to place nodes, right-click to finalize |
| Ruler | Diagonal ruler | Click to start, move, click to finish — ephemeral measurement overlay |

### DrawingEditToolbar

Floating toolbar positioned above the selected drawing, rendered per chart instance inside `CandlestickChart.tsx`. Each instance receives a `contractId` prop and only displays when the selected drawing's `contractId` matches — this prevents the popover from appearing on both charts in dual mode. Dark theme (`#1e222d` background, `#2a2e39` border, 8px border-radius, `0 4px 16px` shadow).

**Layout:** `[ Pencil+color | T ] | [ ─ 1px ] | [ Template v ] | [ Trash ]`

Template button only shown for hline drawings.

- Vertical dividers between logical groups
- 32x32px button targets with 6px border-radius
- Hover: `#363a45` background, lighter text. Active: same but persistent
- Delete: turns red (`#f44336`) on hover

**Sub-popovers:**

1. **ColorPopover** (252px wide): 7×10 color palette grid (grayscale → dark tones), custom color `<input type="color">` via "+" button
2. **TextPopover** (272px wide):
   - Row 1: Color swatch (toggles palette) + font size dropdown + **B** bold + *I* italic
   - Row 2: Multiline textarea (system-ui font, dark grey border, no focus outline)
   - Row 3: "Text alignment" label + vertical (Top/Middle/Bottom) + horizontal (Left/Center/Right) dropdowns
   - Row 4: Cancel / Ok buttons
3. **StrokePopover** (120px wide, centered): visual line thickness previews for 1-4px
4. **TemplatePopover** (220px wide, hline only): saved style templates with export/import

**Positioning:** Computed from drawing coordinates via `series.priceToCoordinate()` and `chart.timeScale().timeToCoordinate()`. Repositions on viewport changes via `subscribeVisibleLogicalRangeChange`.

---

## Primitive Rendering

### DrawingsPrimitive (orchestrator)

Implements `ISeriesPrimitive<Time>`. Manages an array of `HLinePaneView | OvalPaneView | ArrowPathPaneView | RulerPaneView`.

Key methods:
- `setDrawings(drawings, selectedId)` — rebuilds views, calls `requestUpdate()`
- `setDragPreview(x1, y1, x2, y2)` / `clearDragPreview()` — dashed ellipse during oval creation
- `setArrowPathPreview(points)` / `clearArrowPathPreview()` — dashed polyline during arrow path creation
- `setRulerDragPreview(x1, y1, x2, y2, metrics, decimals)` / `clearRulerDragPreview()` — ruler rectangle + label preview
- `getHandleAt(x, y)` — hit-test resize handles on selected oval/ruler
- `hitTest(x, y)` — returns `PrimitiveHoveredItem` with `externalId` for click-to-select

### HLineRenderer

Draws a full-width horizontal line at the drawing's price level.

- Stroke: `drawing.color`, `drawing.strokeWidth`
- Selected: 3 small handle squares (left edge, center, right edge)
- Text label: positioned by `hAlign` (left=8px, center=mid, right=width-8) and `vAlign` (top/middle/bottom relative to line)
- Font: `system-ui, -apple-system, sans-serif` with configurable size/bold/italic
- Hit test: `|mouseY - lineY| <= 5px`, excludes price scale area (`mouseX >= timeScale.width()`)

### OvalRenderer

Draws an ellipse inscribed in the bounding rectangle defined by p1 and p2.

- `ctx.ellipse(cx, cy, rx, ry, 0, 0, 2*PI)` + stroke
- Selected: 4 circular handles (white fill, oval color stroke) at cardinal points (top, bottom, left, right)
- Text label: positioned relative to ellipse center and radii
- Hit test: normalized ellipse distance check `|d - 1.0| < tolerance / min(rx, ry)`
- Resize handles: 4 positions (n, s, w, e) with 6px hit tolerance, free diagonal drag supported

---

## Interactions (in CandlestickChart.tsx)

All drawing interactions are in the first `useEffect` (drawings effect). Event handlers are registered on the chart container with priority ordering.

### Event listener priority

```
1. onResizeMouseDown    — resize handles on selected oval/ruler (most specific)
2. onDrawingDragMouseDown — drag-to-move any drawing
3. onOvalMouseDown      — oval creation when tool is 'oval'
```

Plus shared `mousemove` and `mouseup` on `window` for all interactions. Arrow path and ruler use click-based state machines in `onOvalMouseUp`.

### Horizontal line placement

- Tool: `hline`
- Click on chart → `series.coordinateToPrice(y)` → `addDrawing({type:'hline', price, ...})`
- Auto-switches to select tool after placement

### Oval creation (drag-to-create)

- Tool: `oval`
- `mousedown` records start point, disables chart scroll
- `mousemove` shows live ellipse preview via `primitive.setDragPreview()`
- `mouseup` creates oval if drag distance > 5px, switches to select tool
- Minimum drag threshold prevents accidental creation on clicks

### Arrow path creation (click-to-place nodes)

- Tool: `arrowpath`
- Click to place polyline nodes (each click adds a point)
- Live preview line follows cursor from last placed node
- Right-click finalizes the path (adds final point at cursor, creates drawing if >= 2 points)
- Escape cancels creation
- Arrow tip drawn at the last point

### Ruler measurement (click-move-click, ephemeral)

- Tool: `ruler`
- First click sets the start point, disables chart scroll
- Mouse move shows live preview: semi-transparent rectangle fill + metrics label (price change, %, bar count, time span, volume)
- Second click finalizes — preview stays visible, tool switches to select
- **Ephemeral**: ruler is NOT persisted to the store. Next left-click or Escape dismisses the overlay
- Negative rulers (price went down): stronger red rectangle (`#d32f2f` at 0.25 alpha), darker red label (`#8b2232` at 0.85 alpha)
- Positive rulers: blue rectangle and label (`#2962ff`)
- Metrics computed via `computeRulerMetrics(bars, p1, p2)` from `rulerMetrics.ts`

### Click-to-select

- `chart.subscribeClick()` handler
- If `hoveredObjectId` from `hitTest()` → `setSelectedDrawingId(id)`
- If no hovered object → `setSelectedDrawingId(null)` (deselect)

### Drag-to-move

- Tool: `select`
- `mousedown` on drawing body → records original position, disables chart scroll
- 3px movement threshold distinguishes click from drag
- **hline**: `coordinateToPrice(mouseY)` → `updateDrawing(id, { price })`
- **oval**: compute time/price delta from start → shift both p1 and p2 by same offset
- `mouseup` clears drag state, re-enables chart scroll
- `drawingDragOccurred` flag suppresses the `subscribeClick` that follows mouseup

### Oval resize

- Only when oval is selected (select tool active)
- `mousedown` on a resize handle → records fixed opposite point + handle type
- 4 handles (n/s/e/w): opposite point stays fixed, dragged handle follows mouse freely in both axes (diagonal resize supported)
- Uses data coordinates (time/price) for stable resize during viewport changes

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Cancel in-progress drag (reverts to original position) → cancel resize → cancel tool → deselect |
| `Delete` / `Backspace` | Remove selected drawing (guarded: not in input/textarea) |
| `Ctrl+Z` / `Cmd+Z` | Undo last drawing mutation (see `drawing-tools/undo/README.md`) |

### Cursor management

- Drawing tool active (`hline`/`oval`/`arrowpath`/`ruler`): `crosshair`
- Select tool: `none` (default — hides cursor over chart)
- Hovering resize handle: directional resize cursor (`nwse-resize`, `ns-resize`, etc.)
- During drag: cursor unchanged (stays as whatever it was)

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
                    → store.setSelectedDrawingId(id)
                    → DrawingEditToolbar appears above drawing
                    → primitive.setDrawings() marks it selected → handles appear

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

1. **Saved templates list**: each row shows `[color dot] [stroke preview] [name] [× delete]`
   - Click row → applies template's color, strokeWidth, text to the selected drawing
   - Delete button (×) appears on hover via `group-hover:opacity-100`
2. **Divider** (if templates exist)
3. **"Save as..."** button → toggles inline save form:
   - Text input (auto-focused) + "Save" button
   - Enter to save, Escape to cancel
   - Saves current drawing's color, strokeWidth, and text as a new template with `crypto.randomUUID()` ID
4. **"Apply defaults"** button → resets drawing to `DEFAULT_HLINE_COLOR` (#787b86), strokeWidth 1, no text
5. **Divider**
6. **Export / Import** row:
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

## Persistence

Drawings and hline templates are persisted to localStorage via Zustand's `persist` middleware (key: `chart-store`). The `partialize` function includes `drawings`, `drawingToolbarOpen`, and `hlineTemplates`.

Each drawing stores a `contractId` to scope it per instrument. When rendering, drawings are filtered: `drawings.filter(d => d.contractId === String(contract.id))`.

---

## Color Palette

Both the color picker and text color picker use the same 7×10 grid:

| Row | Theme |
|-----|-------|
| 1 | Grayscale (#f2f2f2 → #000000) |
| 2 | Bright (#ff4d4f, #ffa500, #ffd84d, ...) |
| 3 | Light pastels |
| 4 | Soft tones |
| 5 | Medium tones |
| 6 | Strong tones |
| 7 | Dark tones |

Plus a "+" button for custom colors via native `<input type="color">`.
