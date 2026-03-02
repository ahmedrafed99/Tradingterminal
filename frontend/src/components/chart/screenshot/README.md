# Chart Screenshot

Capture the chart as a PNG image and copy it to the clipboard.

## Usage

A **camera icon** in the chart toolbar opens a dropdown with two actions:

| Action | Behavior |
|---|---|
| **Copy chart image** | Instantly captures the chart (with all overlays) and copies a PNG to the clipboard. A checkmark flashes on the icon for 1.5 s as confirmation. |
| **Custom snapshot** | Opens a preview modal with three toggles &mdash; **Drawings**, **Positions**, **Trades** &mdash; to include/exclude each overlay. Inspect the result, then copy to clipboard. |

In **dual-chart mode** both charts are composited side-by-side into a single image with a 2 px separator strip.

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
| `overlayEl` | `HTMLElement \| null` | DOM ref to the chart overlay div containing position/order labels |
| `instrumentEl` | `HTMLElement \| null` | DOM ref to the instrument label overlay (text painted onto canvas) |
| `ohlcEl` | `HTMLElement \| null` | DOM ref to the OHLC tooltip overlay (text painted onto canvas) |
| `orderLinesRef` | `{ current: PriceLine[] }` | Mutable ref to live order/position price lines (SL, TP, entry); made transparent when `showPositions` is false |
| `previewLinesRef` | `{ current: PriceLine[] }` | Mutable ref to preview bracket price lines; made transparent when `showPositions` is false |

A `ScreenshotOptions` type controls what each capture includes:

| Flag | Controls |
|---|---|
| `showDrawings` | Drawing primitives (HLine, oval, arrow) |
| `showTrades` | Trade zone rectangles and entry/exit labels |
| `showPositions` | Position/order overlay labels (P&L, size, SL/TP) **and** their canvas price lines |

### Screenshot capture flow (`screenshotEntry`)

1. **Toggle visibility** &mdash; if `showDrawings` is false, set `primitive.visible = false`; if `showTrades` is false, set `tradeZonePrimitive.visible = false`. Both primitives' `paneViews()` return an empty array when hidden. If `showPositions` is false, all order/position/preview price lines are made transparent (`color: 'transparent'`, `axisLabelVisible: false`) via `applyOptions`.
2. **Take screenshot** &mdash; call `chart.takeScreenshot(true)` which renders a fresh `HTMLCanvasElement` including all visible primitives.
3. **Restore visibility** &mdash; re-enable drawing/trade primitives and restore saved color + axis label options on all hidden price lines.
4. **Paint text overlays** &mdash; read text content from the instrument and OHLC DOM refs and draw them onto the canvas with Canvas 2D API (these are HTML overlays that `takeScreenshot` doesn't capture).
5. **Paint position labels** &mdash; if `showPositions` is true, `paintOverlayLabels()` reads children from the overlay div and paints each position/order row as colored cell rectangles (skipping interactive buttons like close, +SL, +TP).
6. **Dual-chart composite** &mdash; if in dual mode, repeat for the right chart and draw both canvases side-by-side onto a new composite canvas.
7. **Time banner** &mdash; before copying to clipboard, `addTimeBanner()` composites a 30 px black header strip above the chart image showing the current date and NY time (e.g. "Mar 2, 2026  14:32:07 New York"). This banner only appears in the final copied PNG &mdash; the preview modal shows the raw chart.

### Clipboard write

The canvas is converted to a blob via `toBlob()`, null-checked, then written:

```ts
const blob = await new Promise<Blob | null>(resolve => {
  canvas.toBlob(resolve, 'image/png');
});
if (!blob) return;
await navigator.clipboard.write([
  new ClipboardItem({ 'image/png': blob }),
]);
```

### Snapshot preview modal (`SnapshotPreview.tsx`)

- Opens as a full-screen backdrop with blur + a centered panel.
- **Pre-caches all 8 toggle combinations** (2^3 for Drawings/Trades/Positions) on mount in a single synchronous batch, storing both the canvas and its data URL. This avoids calling `takeScreenshot()` on toggle changes, which would force a chart re-render and cause the live price/countdown to visibly jump.
- When any toggle changes, the cached data URL is swapped in directly &mdash; no chart interaction or PNG re-encoding.
- The cache is cleared on unmount to release the canvas memory.
- "Copy to clipboard" writes the current canvas blob, flashes "Copied" for 0.8 s, then auto-closes.
- Press **Escape** or click the backdrop to close without copying.

## Files

```
screenshot/
  chartRegistry.ts    Module-level chart API registry
  SnapshotPreview.tsx  Custom snapshot preview modal
  addTimeBanner.ts    Composites a date+time header onto the final PNG
  README.md            This file
```

## Related modifications

- **`CandlestickChart.tsx`** &mdash; calls `registerChart()` / `unregisterChart()` in its chart-creation effect, passes DOM refs for the instrument label, OHLC overlay, overlay div, `tradeZonePrimitive`, `orderLinesRef`, and `previewLinesRef`.
- **`ChartToolbar.tsx`** &mdash; contains the camera icon, dropdown menu, `screenshotEntry()` helper, `paintOverlayLabels()` for position labels, and `captureChartCanvas()` compositing logic.
- **`TradeZonePrimitive.ts`** &mdash; added a `visible` flag checked by `paneViews()` to exclude trade zones from screenshots.
- **`DrawingsPrimitive.ts`** &mdash; added a `visible` flag checked by `paneViews()` to exclude drawings from screenshots.
- **`index.css`** &mdash; `animate-backdrop-in` and `animate-modal-in` keyframe animations used by the preview modal.
