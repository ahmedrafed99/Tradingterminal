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

A `ScreenshotOptions` type controls what each capture includes:

| Flag | Controls |
|---|---|
| `showDrawings` | Drawing primitives (HLine, oval, arrow) |
| `showTrades` | Trade zone rectangles and entry/exit labels |
| `showPositions` | Position and order overlay labels (P&L, size, SL/TP) |

### Screenshot capture flow (`screenshotEntry`)

1. **Toggle visibility** &mdash; if `showDrawings` is false, set `primitive.visible = false`; if `showTrades` is false, set `tradeZonePrimitive.visible = false`. Both primitives' `paneViews()` return an empty array when hidden.
2. **Take screenshot** &mdash; call `chart.takeScreenshot(true)` which renders a fresh `HTMLCanvasElement` including all visible primitives.
3. **Restore visibility** &mdash; re-enable both primitives.
4. **Paint text overlays** &mdash; read text content from the instrument and OHLC DOM refs and draw them onto the canvas with Canvas 2D API (these are HTML overlays that `takeScreenshot` doesn't capture).
5. **Paint position labels** &mdash; if `showPositions` is true, `paintOverlayLabels()` reads children from the overlay div and paints each position/order row as colored cell rectangles (skipping interactive buttons like close, +SL, +TP).
6. **Dual-chart composite** &mdash; if in dual mode, repeat for the right chart and draw both canvases side-by-side onto a new composite canvas.

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

- Opens as a full-screen backdrop with blur + a centered panel.
- **Pre-caches all 8 toggle combinations** (2^3 for Drawings/Trades/Positions) on mount in a single synchronous batch. This avoids calling `takeScreenshot()` on toggle changes, which would force a chart re-render and cause the live price/countdown to visibly jump.
- When any toggle changes, the cached canvas is looked up by key and converted to a data URL &mdash; no chart interaction.
- The preview is an `<img>` fed by `canvas.toDataURL('image/png')`.
- "Copy to clipboard" writes the current canvas blob, flashes "Copied" for 0.8 s, then auto-closes.
- Press **Escape** or click the backdrop to close without copying.

## Files

```
screenshot/
  chartRegistry.ts    Module-level chart API registry
  SnapshotPreview.tsx  Custom snapshot preview modal
  README.md            This file
```

## Related modifications

- **`CandlestickChart.tsx`** &mdash; calls `registerChart()` / `unregisterChart()` in its chart-creation effect, passes DOM refs for the instrument label, OHLC overlay, overlay div, and `tradeZonePrimitive`.
- **`ChartToolbar.tsx`** &mdash; contains the camera icon, dropdown menu, `screenshotEntry()` helper, `paintOverlayLabels()` for position labels, and `captureChartCanvas()` compositing logic.
- **`TradeZonePrimitive.ts`** &mdash; added a `visible` flag checked by `paneViews()` to exclude trade zones from screenshots.
- **`DrawingsPrimitive.ts`** &mdash; added a `visible` flag checked by `paneViews()` to exclude drawings from screenshots.
- **`index.css`** &mdash; `animate-backdrop-in` and `animate-modal-in` keyframe animations used by the preview modal.
