# Feature: Chart Screenshot

Capture the chart as a PNG image and copy it to the clipboard.

**Status**: Implemented

---

## Usage

A **camera icon** in the chart toolbar opens a dropdown with two actions:

| Action | Behavior |
|---|---|
| **Copy chart image** | Instantly captures the chart (with drawings) and copies a PNG to the clipboard. A checkmark flashes on the icon for 1.5 s as confirmation. |
| **Custom snapshot** | Opens a preview modal where you can toggle drawings on/off, inspect the result, then copy to clipboard. |

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
| `instrumentEl` | `HTMLElement \| null` | DOM ref to the instrument label overlay (text painted onto canvas) |
| `ohlcEl` | `HTMLElement \| null` | DOM ref to the OHLC tooltip overlay (text painted onto canvas) |

### Screenshot capture flow

1. **Toggle drawings** — if `showDrawings` is false, set `primitive.visible = false` so `paneViews()` returns an empty array.
2. **Take screenshot** — call `chart.takeScreenshot(true)` which renders a fresh `HTMLCanvasElement` including all visible primitives.
3. **Restore drawings** — set `primitive.visible = true`.
4. **Paint overlays** — read text content from the instrument and OHLC DOM refs and draw them onto the canvas with Canvas 2D API (these are HTML overlays that `takeScreenshot` doesn't capture).
5. **Dual-chart composite** — if in dual mode, repeat for the right chart and draw both canvases side-by-side onto a new composite canvas.

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
- Captures on mount and re-captures whenever the **Show drawings** toggle changes.
- The preview is an `<img>` fed by `canvas.toDataURL('image/png')`.
- "Copy to clipboard" writes the current canvas blob, flashes "Copied" for 0.8 s, then auto-closes.
- Press **Escape** or click the backdrop to close without copying.

---

## Files

```
frontend/src/components/chart/screenshot/
  chartRegistry.ts    Module-level chart API registry
  SnapshotPreview.tsx  Custom snapshot preview modal
```

---

## Related modifications

- **`CandlestickChart.tsx`** — calls `registerChart()` / `unregisterChart()` in its chart-creation effect, passes DOM refs for the instrument label and OHLC overlay.
- **`ChartToolbar.tsx`** — contains the camera icon, dropdown menu, `screenshotEntry()` helper, and `captureChartCanvas()` compositing logic.
- **`DrawingsPrimitive.ts`** — added a `visible` flag checked by `paneViews()` to exclude drawings from screenshots.
- **`index.css`** — `animate-backdrop-in` and `animate-modal-in` keyframe animations used by the preview modal.
