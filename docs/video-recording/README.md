# Feature: Chart Video Recording

Record the live chart as a WebM video for review and documentation.

**Status**: Planned

---

## Use Case

Capture chart action during trades so you can review how price developed — not just a static screenshot but the full replay of candle-by-candle action. Recordings are stored on the backend for later playback.

---

## Approach: Offscreen Composite Canvas + `captureStream()` + MediaRecorder

### Why this approach

- **Zero friction** — no browser permission prompt, starts instantly (unlike `getDisplayMedia()` which pops a dialog every time)
- **Background encoding** — browser handles VP9 encoding on a separate thread, ~2-5% CPU overhead, no chart lag
- **Native output** — WebM (VP9) natively, no transcoding needed
- **Full overlay capture** — composites HTML overlays onto the canvas every frame

### What it captures

Everything visible on the chart:
- Candlesticks, indicators, drawing primitives, trade zone markers (rendered on the Lightweight Charts canvas)
- Instrument label, OHLC tooltip (HTML overlays, painted via Canvas 2D API)
- Position/order price lines (HTML overlays, painted via `PriceLevelLine.paintToCanvas()`)

### How the composite works

1. Create an offscreen `<canvas>` matching the chart dimensions
2. On each `requestAnimationFrame`:
   - Draw the live Lightweight Charts canvas onto the offscreen canvas
   - Paint HTML overlays using the same logic as `screenshotEntry()` in `ChartToolbar.tsx`:
     - Instrument label (`entry.instrumentEl.textContent`) via `ctx.fillText()`
     - OHLC tooltip (`entry.ohlcEl.textContent`) via `ctx.fillText()` with background rect
     - Position/order price lines via `PriceLevelLine.paintToCanvas(ctx, plotWidth)`
3. Stream the offscreen canvas via `captureStream(30)` → MediaRecorder (VP9, fallback VP8)

The overlay painting is just a few `fillText`/`fillRect` calls per frame — negligible cost.

### Expected file sizes

Chart content compresses very well (dark background, thin lines, low motion):

| Duration | Size |
|----------|------|
| 1 min | ~2-4 MB |
| 5 min | ~8-15 MB |
| 30 min | ~40-80 MB |

---

## Implementation Phases

### Phase 1: Core Recording (Frontend)

**Extend chart registry** (`frontend/src/components/chart/screenshot/chartRegistry.ts`)
- Add `containerEl: HTMLElement | null` to `ChartEntry` interface
- Pass `containerRef.current` during `registerChart()` in `CandlestickChart.tsx`
- Access live canvas via `containerEl.querySelector('canvas')`

**Extract overlay painting** to shared utility
- Move overlay painting logic from `screenshotEntry()` (`ChartToolbar.tsx:348-388`) into a reusable function:
  ```
  frontend/src/components/chart/screenshot/paintOverlays.ts
  ```
  ```ts
  paintOverlays(ctx, entry, plotWidth, options: { showPositions: boolean })
  ```
- Both the screenshot feature and recording service call this same function

**Create recording service** (`frontend/src/components/chart/recording/RecordingService.ts`)
- Singleton service (same pattern as `audioService.ts`)
- `startRecording(chartId)`:
  1. Get `ChartEntry` from registry
  2. Get live canvas from `containerEl.querySelector('canvas')`
  3. Create offscreen composite canvas (same dimensions)
  4. Start `requestAnimationFrame` loop that draws live canvas + paints overlays
  5. Call `compositeCanvas.captureStream(30)` → create MediaRecorder (VP9, fallback VP8)
  6. `recorder.start(1000)` — flush chunks every 1s
- `stopRecording()` → cancel rAF loop, stop recorder, return assembled `Blob`
- State: `idle | recording`, startTime, chartId
- Event listener pattern for state changes
- Auto-stop safeguard (default 60 min)

**Create React hook** (`frontend/src/components/chart/recording/useRecording.ts`)
- Wraps RecordingService state
- Returns `{ isRecording, elapsed, start, stop }`

**Add recording button** to `ChartToolbar.tsx`
- Next to existing camera button: `[Screenshot] [Record] | [NY clock]`
- Idle: video camera icon, `text-(--color-text-muted)`
- Recording: pulsing red dot + elapsed timer (e.g. "1:23"), `text-(--color-sell)`
- Click toggles start/stop
- On stop → upload to backend, brief toast confirmation

**Create recording indicator** (`frontend/src/components/chart/recording/RecordingIndicator.tsx`)
- Pulsing red dot + elapsed time display
- CSS `@keyframes` for pulse animation

### Phase 2: Backend Storage

**Create recording routes** (`backend/src/routes/recordingRoutes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/recordings/upload` | Upload video (`express.raw()`, metadata in headers, 200 MB limit) |
| `GET` | `/recordings` | List recordings (filters: `from`, `to`) |
| `GET` | `/recordings/:id/video` | Serve video with HTTP Range request support (seeking) |
| `DELETE` | `/recordings/:id` | Delete recording + file |

**Storage (configurable path):**

The recordings directory is user-configurable via `recordingsPath` in user settings (`/settings` route). Defaults to `backend/data/recordings/` but can be pointed at any folder (external drive, NAS, etc.).

```
{recordingsPath}/              — User-configurable, default: backend/data/recordings/
  {uuid}.webm                  — Video files
  recordings.json              — Metadata index
```

- On startup, backend reads `recordingsPath` from `user-settings.json`
- If the path doesn't exist, create it
- All recording routes resolve paths relative to `recordingsPath`
- User configures the path in **App Settings → Recording** tab (top-right gear icon)
  - Folder path input with browse/paste
  - Shows current disk usage (total size of stored recordings)
  - Default path shown as placeholder when empty

**Metadata schema:**
```ts
interface RecordingMeta {
  id: string;            // UUID
  createdAt: string;     // ISO 8601
  duration: number;      // seconds
  fileSize: number;      // bytes
  filename: string;      // e.g. "abc123.webm"
  symbol: string;        // instrument at time of recording
  timeframe: string;     // e.g. "1m"
  chartId: string;       // "left" or "right"
}
```

### Phase 3: Upload & Playback UI

**Create API client** (`frontend/src/services/recordingApi.ts`)
- `uploadRecording(blob, metadata)` — POST to backend
- `listRecordings(filters)` — GET
- `deleteRecording(id)` — DELETE
- Video URL construction for `<video src>`

Wire stop → auto-upload in RecordingService/ChartToolbar.

Recordings list accessible from toolbar.

---

## Files

### Modified
| File | Change |
|------|--------|
| `frontend/src/components/chart/screenshot/chartRegistry.ts` | Add `containerEl` to `ChartEntry` |
| `frontend/src/components/chart/CandlestickChart.tsx` | Pass `containerRef` on register |
| `frontend/src/components/chart/ChartToolbar.tsx` | Add record button, extract overlay painting |
| `backend/src/index.ts` | Mount recording routes |
| `backend/src/routes/settingsRoutes.ts` | Add `recordingsPath` to settings schema/defaults |

### New
| File | Purpose |
|------|---------|
| `frontend/src/components/chart/screenshot/paintOverlays.ts` | Shared overlay painting (extracted from screenshotEntry) |
| `frontend/src/components/chart/recording/RecordingService.ts` | Core recording logic |
| `frontend/src/components/chart/recording/useRecording.ts` | React hook |
| `frontend/src/components/chart/recording/RecordingIndicator.tsx` | Pulsing red dot + timer |
| `backend/src/routes/recordingRoutes.ts` | CRUD + video serving |
| `frontend/src/services/recordingApi.ts` | API client |

---

## Verification

1. Click record → red pulsing indicator appears with timer
2. Let chart run for 30s-1min, draw on chart, watch candles form
3. Click stop → video uploads, toast confirms
4. Play back video — verify candles, drawings, trade zones, instrument label, OHLC, and price lines are all visible
5. Test seeking (range requests work)
6. Verify chart performance is unaffected during recording (no dropped frames or lag)
