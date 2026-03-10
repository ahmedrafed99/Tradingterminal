# Feature: Chart Screenshot

Capture the chart as a PNG image and copy it to the clipboard.

**Status**: Implemented

---

## Usage

A **camera icon** in the chart toolbar opens a dropdown with two actions:

| Action | Behavior |
|---|---|
| **Copy chart image** | Instantly captures the chart (with all overlays) and copies a PNG to the clipboard. A checkmark flashes on the icon for 1.5 s as confirmation. |
| **Custom snapshot** | Opens a preview modal with three toggles — **Drawings**, **Positions**, **Trades** — to include/exclude each overlay. Inspect the result, then copy to clipboard. |

In **dual-chart mode** both charts are composited side-by-side into a single image with a 2 px separator strip.

---

## How it works

### Chart registry (`chartRegistry.ts`)

A module-level `Map<string, ChartEntry>` that lets sibling components share chart API references without prop-drilling or storing mutable objects in Zustand.

```
CandlestickChart  ──  registerChart(id, entry)  ──►  Map
ChartToolbar      ──  getChartEntry(id)          ◄──  Map
```

Each `ChartEntry` stores:

| Field | Type | Purpose |
|---|---|---|
| `chart` | `IChartApi` | Lightweight Charts instance (provides `takeScreenshot()`) |
| `primitive` | `DrawingsPrimitive \| null` | Drawings layer; its `visible` flag is toggled to include/exclude drawings |
| `tradeZonePrimitive` | `TradeZonePrimitive \| null` | Trade zone layer; its `visible` flag is toggled to include/exclude trade markers |
| `overlayEl` | `HTMLElement \| null` | DOM ref to the chart overlay div |
| `instrumentEl` | `HTMLElement \| null` | DOM ref to the instrument label overlay (text painted onto canvas) |
| `ohlcEl` | `HTMLElement \| null` | DOM ref to the OHLC tooltip overlay (text painted onto canvas) |
| `orderLinesRef` | `{ current: PriceLevelLine[] }` | Mutable ref to live order/position `PriceLevelLine` instances |
| `orderLineMetaRef` | `{ current: OrderLineMeta[] }` | Parallel metadata array — `{ kind: 'position' }` or `{ kind: 'order' }` for each entry in `orderLinesRef` |
| `previewLinesRef` | `{ current: PriceLevelLine[] }` | Mutable ref to preview bracket `PriceLevelLine` instances |

A `ScreenshotOptions` type controls what each capture includes:

| Flag | Controls |
|---|---|
| `showDrawings` | Drawing primitives (HLine, oval, arrow) |
| `showTrades` | Trade zone rectangles and entry/exit labels |
| `showPositions` | Position entry line + associated SL/TP order lines. Preview bracket lines are never included. |

### Screenshot capture flow (`screenshotEntry`)

1. **Toggle visibility** — if `showDrawings` is false, set `primitive.visible = false`; if `showTrades` is false, set `tradeZonePrimitive.visible = false`. Both primitives' `paneViews()` return an empty array when hidden.
2. **Take screenshot** — call `chart.takeScreenshot(true)` which renders a fresh `HTMLCanvasElement` including all visible canvas primitives. Price lines (order, position, preview) are HTML elements, so they are NOT captured by `takeScreenshot`.
3. **Restore visibility** — re-enable both primitives.
4. **Paint text overlays** — read text content from the instrument and OHLC DOM refs and draw them onto the canvas with Canvas 2D API (these are HTML overlays that `takeScreenshot` doesn't capture).
5. **Paint position lines** — if `showPositions` is true, iterate all lines in `orderLinesRef` (position entry + its SL/TP orders) and call `line.paintToCanvas(ctx, plotWidth)` on each. Preview bracket lines (`previewLinesRef`) are never painted — they are pre-submission ghosts, not real orders.
6. **Dual-chart composite** — if in dual mode, repeat for the right chart and draw both canvases side-by-side onto a new composite canvas.
7. **Time banner** — before copying to clipboard, `addTimeBanner()` composites a 30 px black header strip above the chart image showing the current date and NY time (e.g. "Mar 2, 2026  14:32:07 New York"). This banner only appears in the final copied PNG — the preview modal shows the raw chart.

### Clipboard write

The Clipboard API requires an active user gesture. Since `canvas.toBlob()` is async and would lose the gesture context, we pass a `Promise` directly to `ClipboardItem`:

```ts
new ClipboardItem({
  'image/png': new Promise(resolve =>
    canvas.toBlob(blob => resolve(blob!), 'image/png')
  ),
})
```

This keeps the write within the original user-activation window.

### Snapshot preview modal (`SnapshotPreview.tsx`)

- Uses the shared `<Modal>` component (`shared/Modal.tsx`) for backdrop, Escape key, and click-outside behavior. Passes `backdropClassName="animate-backdrop-in"` and `backdropStyle={{ backdropFilter: 'blur(4px)' }}` for the blur effect.
- Opens as a full-screen backdrop with blur + a centered panel.
- **Pre-caches all 8 toggle combinations** (2^3 for Drawings/Trades/Positions) on mount in a single synchronous batch. This avoids calling `takeScreenshot()` on toggle changes, which would force a chart re-render and cause the live price/countdown to visibly jump.
- When any toggle changes, the cached canvas is looked up by key and converted to a data URL — no chart interaction.
- The preview is an `<img>` fed by `canvas.toDataURL('image/png')`.
- "Copy to clipboard" writes the current canvas blob, flashes "Copied" for 0.8 s, then auto-closes.
- Press **Escape** or click the backdrop to close without copying.

---

## Files

```
frontend/src/components/chart/screenshot/
  chartRegistry.ts    Module-level chart API registry
  SnapshotPreview.tsx  Custom snapshot preview modal
  addTimeBanner.ts    Composites a date+time header onto the final PNG
```

---

## Related modifications

- **`CandlestickChart.tsx`** — calls `registerChart()` / `unregisterChart()` in its chart-creation effect, passes DOM refs for the instrument label, OHLC overlay, overlay div, `tradeZonePrimitive`, and `PriceLevelLine` refs (`orderLinesRef`, `orderLineMetaRef`, `previewLinesRef`).
- **`ChartToolbar.tsx`** — contains the camera icon, dropdown menu, `screenshotEntry()` helper (calls `line.paintToCanvas()` for each `PriceLevelLine`), and `captureChartCanvas()` compositing logic.
- **`TradeZonePrimitive.ts`** — added a `visible` flag checked by `paneViews()` to exclude trade zones from screenshots.
- **`DrawingsPrimitive.ts`** — added a `visible` flag checked by `paneViews()` to exclude drawings from screenshots.
- **`index.css`** — `animate-backdrop-in` and `animate-modal-in` keyframe animations used by the preview modal.
