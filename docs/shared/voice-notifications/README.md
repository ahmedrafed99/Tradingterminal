# Voice Notifications

Plays pre-recorded voice clips on order fill events so the trader gets immediate audible feedback without watching the screen. Supports multiple voice lines per event that cycle sequentially for variety.

---

## Sound Files

Default clips are located in `frontend/public/sounds/{category}/1.mp3` (served by Vite):

| Folder | Trigger |
|--------|---------|
| `order_filled/` | Entry order filled (market or limit) |
| `target_filled/` | Take-profit order filled |
| `stop_filled/` | Stop-loss order filled |
| `position_closed/` | Manual close (Close button or chart X) |

User-uploaded voice lines are stored in **IndexedDB** (`voice-lines` database) and appear alongside the default clip (default always remains in the list).

---

## Audio Service

**File:** `frontend/src/services/audioService.ts`

Singleton `audioService` that:
1. **Loads** default clip + user-uploaded clips from IndexedDB on startup
2. **Cycles** sequentially through available clips on each `play()` call (1 → 2 → 3 → 1 …), or plays only the first clip when rotation is disabled
3. **Persists** `enabled`, `volume`, `rotate` (per-category), and `clipOrder` (per-category) in `localStorage` key `sound-settings`

### API

```ts
// Playback
audioService.play('order_filled' | 'target_filled' | 'stop_filled' | 'position_closed')
audioService.playClip(name, index)   // play a specific clip (0-based)

// Clip management
audioService.addClips(category, files)   // upload File[] to IndexedDB
audioService.removeClip(category, id)    // delete a clip by IDB id
audioService.reorderClip(category, from, to) // move clip from index to index
audioService.getClips(name)              // returns { id?, name }[]
audioService.getClipCount(name)

// Settings
audioService.getEnabled() / setEnabled(boolean)
audioService.getVolume()  / setVolume(number)  // 0–1
audioService.getRotate(name) / setRotate(name, boolean)  // per-category rotation

// Events
audioService.onChange(fn)   // subscribe to clip list changes, returns unsubscribe fn
audioService.ready()        // Promise that resolves when IDB clips are loaded
```

---

## Trigger Points

### Bracket Engine (`bracketEngine.ts`)

When a bracket session is active, the engine classifies fills precisely and tracks handled order IDs to prevent duplicate sounds on partial fills (multi-contract orders):

| Event | Method | Sound |
|-------|--------|-------|
| Entry order filled | `onEntryFilled()` | `order_filled` |
| TP order filled | `onOrderEvent()` (TP match) | `target_filled` |
| SL order filled | `onOrderEvent()` (SL match) | `stop_filled` |

### Manual Close Tracker (`manualCloseTracker.ts`)

Tracks manual close actions by contractId. Called **before** `placeOrder()` to avoid race conditions with SignalR fill events arriving before the REST response.

| Source | Sound |
|--------|-------|
| Close button (`PositionDisplay.tsx`) | `position_closed` |
| Chart X button (`buildPositionLabel.ts`) | `position_closed` |

### Ad-Hoc Orders (`OrderPanel.tsx`)

When no bracket session is active and the order wasn't handled by the bracket engine or manual close tracker, classifies by `customTag` with a type-based fallback for SL only (Stop/TrailingStop types are almost always stop-losses). Limit orders are **not** assumed to be TPs — without a tag they play the generic entry sound, since limit orders are commonly used as entries.

| Custom Tag | Fallback (no tag) | Sound |
|------------|-------------------|-------|
| Ends with `-SL` | `Stop` / `TrailingStop` order type | `stop_filled` |
| Ends with `-TP` | — | `target_filled` |
| Neither | — | `order_filled` |

---

## Settings UI

**File:** `frontend/src/components/settings/SoundTab.tsx`

Accessible via **Settings (gear icon) → Sound** tab.

Controls:
- **On/Off toggle** — enables or disables all voice notifications
- **Volume slider** — 0–100% range, applied to all sounds
- **Voice Lines** — expandable per-category sections:
  - Default clip always present; uploaded clips appear alongside it
  - First clip (next-to-play) highlighted with a golden left accent border (`--color-warning`)
  - **Rotate toggle** — appears when 2+ clips exist; when off, always plays the first clip
  - **Drag to reorder** — grab the 6-dot handle to rearrange clip play order (persisted in localStorage)
  - Clip rows highlight on hover
  - **Play** and **delete** buttons appear on hover per clip row
  - **Upload zone** — click to browse or drag & drop audio files (accepts multiple, any audio format)

The settings modal is top-aligned (`items-start` with `8vh` top margin) so expanding voice line categories grows the modal downward only.

---

## Adding Voice Lines

### Via Settings UI (recommended)

1. Open **Settings → Sound**
2. Expand a sound category (Entry Filled, Target Filled, Stop Filled, Position Closed)
3. Click the upload zone or drag audio files into it
4. Clips are stored in IndexedDB and persist across sessions

### Adding a New Sound Category

1. Add the category name to the `SoundName` union type in `audioService.ts`
2. Add it to the `SOUND_NAMES` array
3. Place a default `1.mp3` in `frontend/public/sounds/{category}/`
4. Add a trigger call (`audioService.play('new_name')`) at the appropriate event handler
5. Add a row to the `SOUNDS` array in `SoundTab.tsx`
