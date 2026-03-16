# Feature: Chart Video Recording

Record the live chart as a WebM video for review and documentation.

**Status**: Implemented

---

## Use Case

Capture chart action during trades so you can review how price developed — not just a static screenshot but the full replay of candle-by-candle action. Recordings are saved directly to a user-chosen folder via the File System Access API (no backend involved).

---

## Approach: Offscreen Composite Canvas + `captureStream()` + MediaRecorder

### Why this approach

- **Zero friction** — no browser permission prompt, starts instantly (unlike `getDisplayMedia()` which pops a dialog every time and mutes page audio)
- **Background encoding** — browser handles VP9 encoding on a separate thread, ~2-5% CPU overhead, no chart lag
- **Native output** — WebM (VP9) natively, no transcoding needed
- **Full overlay capture** — composites all chart canvases + HTML overlays every frame
- **No backend** — files written directly to disk via `showDirectoryPicker()` handle

### What it captures

Everything visible on the chart:
- Candlesticks, indicators, drawing primitives, trade zone markers
- Price scale (right) and time scale (bottom)
- Instrument label, OHLC tooltip (painted via Canvas 2D API)
- Position/order price lines (painted via `PriceLevelLine.paintToCanvas()`)
- Optional microphone audio

### What it does NOT capture

- Mouse cursor (OS-level, not part of any canvas)
- Crosshair (rendered as HTML overlay by Lightweight Charts, not on the canvas)
- Desktop/system audio (requires `getDisplayMedia()` which adds a prompt each time)

### How the composite works

1. Create an offscreen `<canvas>` matching the full chart container dimensions (including scales)
2. On each `requestAnimationFrame`:
   - Find all `<canvas>` elements within the chart container
   - Draw each at its correct position using `getBoundingClientRect()` offsets
   - Paint HTML overlays using the shared `paintOverlays()` utility
3. Stream the offscreen canvas via `captureStream(30)` → MediaRecorder (VP9, fallback VP8)
4. Optionally merge microphone audio track via `getUserMedia({ audio: true })`

### Storage

Uses the browser's **File System Access API** (`showDirectoryPicker()`):
- User picks a folder once → handle persisted in IndexedDB across sessions
- On stop, recording is written directly as `recording-{ISO-timestamp}.webm`
- No backend upload, no server storage, no network traffic
- Configurable in **Settings → Recording** tab
- Requires Chrome/Edge with File System Access API enabled (Brave: enable via `brave://flags/#file-system-access-api`)

### Expected file sizes

Chart content compresses very well (dark background, thin lines, low motion):

| Duration | Size |
|----------|------|
| 1 min | ~2-4 MB |
| 5 min | ~8-15 MB |
| 30 min | ~40-80 MB |

---

## Architecture

### Frontend-only — no backend involvement

```
User clicks record
  → RecordingService.startRecording(chartId)
    → getReadyDirectoryHandle() (from IndexedDB) or pickDirectory() (showDirectoryPicker prompt)
    → Create offscreen composite canvas
    → Start rAF loop (draw all chart canvases + overlays)
    → captureStream(30) → MediaRecorder (VP9)
    → Optional: getUserMedia({ audio: true }) for mic

User clicks stop
  → RecordingService.stopRecording()
    → Stop rAF loop + MediaRecorder
    → Assemble Blob from chunks
    → Write to folder via FileSystemDirectoryHandle
```

---

## Files

### Modified
| File | Change |
|------|--------|
| `frontend/src/components/chart/screenshot/chartRegistry.ts` | Add `containerEl` to `ChartEntry` |
| `frontend/src/components/chart/CandlestickChart.tsx` | Pass `containerRef` on register |
| `frontend/src/components/chart/ChartToolbar.tsx` | Add record button, extract overlay painting |
| `frontend/src/components/SettingsModal.tsx` | Add Recording tab |

### New
| File | Purpose |
|------|---------|
| `frontend/src/components/chart/screenshot/paintOverlays.ts` | Shared overlay painting (extracted from screenshotEntry) |
| `frontend/src/components/chart/recording/RecordingService.ts` | Core recording logic (canvas composite + MediaRecorder) |
| `frontend/src/components/chart/recording/useRecording.ts` | React hook |
| `frontend/src/components/chart/recording/RecordingIndicator.tsx` | Pulsing red dot + timer |
| `frontend/src/components/chart/recording/directoryHandle.ts` | IndexedDB persistence for folder handle |
| `frontend/src/components/settings/RecordingTab.tsx` | Settings UI for folder + mic toggle |

---

## Verification

1. Click record → red pulsing indicator appears with timer in toolbar
2. Let chart run for 30s-1min, draw on chart, watch candles form
3. Click stop → `.webm` file appears in the chosen folder
4. Play back video — verify candles, drawings, trade zones, price/time scales, instrument label, OHLC, and price lines are all visible
5. Verify chart performance is unaffected during recording (no dropped frames or lag)
6. Toggle mic in Settings → Recording → Audio, verify mic audio is captured when enabled
