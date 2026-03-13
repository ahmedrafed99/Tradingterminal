# Voice Notifications

Plays pre-recorded voice clips on order fill events so the trader gets immediate audible feedback without watching the screen. Supports multiple voice lines per event that cycle sequentially for variety.

---

## Sound Files

Default clips are located in `frontend/public/sounds/{category}/1.mp3` (served by Vite):

| Folder | Trigger |
|--------|---------|
| `order_filled/` | Entry order filled (market or limit) |
| `target_filled/` | Take-profit limit order filled |
| `stop_filled/` | Stop-loss order filled |

User-uploaded voice lines are stored in **IndexedDB** (`voice-lines` database) and take priority over default clips when present.

---

## Audio Service

**File:** `frontend/src/services/audioService.ts`

Singleton `audioService` that:
1. **Loads** user-uploaded clips from IndexedDB on startup, falling back to default static files
2. **Cycles** sequentially through available clips on each `play()` call (1 → 2 → 3 → 1 …)
3. **Persists** `enabled` (boolean) and `volume` (0–1) in `localStorage` key `sound-settings`

### API

```ts
// Playback
audioService.play('order_filled' | 'target_filled' | 'stop_filled')
audioService.playClip(name, index)   // play a specific clip (0-based)

// Clip management
audioService.addClips(category, files)   // upload File[] to IndexedDB
audioService.removeClip(category, id)    // delete a clip by IDB id
audioService.getClips(name)              // returns { id?, name }[]
audioService.getClipCount(name)

// Settings
audioService.getEnabled() / setEnabled(boolean)
audioService.getVolume()  / setVolume(number)  // 0–1

// Events
audioService.onChange(fn)   // subscribe to clip list changes, returns unsubscribe fn
audioService.ready()        // Promise that resolves when IDB clips are loaded
```

---

## Trigger Points

### Bracket Engine (`bracketEngine.ts`)

When a bracket session is active, the engine classifies fills precisely:

| Event | Method | Sound |
|-------|--------|-------|
| Entry order filled | `onEntryFilled()` | `order_filled` |
| TP order filled | `onOrderEvent()` (TP match) | `target_filled` |
| SL order filled | `onOrderEvent()` (SL match) | `stop_filled` |

### Ad-Hoc Orders (`OrderPanel.tsx`)

When no bracket session is active, the `onOrder` handler classifies by `order.type`:

| Order Type | Sound |
|------------|-------|
| `Stop` / `TrailingStop` | `stop_filled` |
| `Limit` | `target_filled` |
| `Market` (or other) | `order_filled` |

---

## Settings UI

**File:** `frontend/src/components/settings/SoundTab.tsx`

Accessible via **Settings (gear icon) → Sound** tab.

Controls:
- **On/Off toggle** — enables or disables all voice notifications
- **Volume slider** — 0–100% range, applied to all sounds
- **Voice Lines** — expandable per-category sections:
  - Lists all clips with **play** and **delete** buttons
  - **Upload zone** — click to browse or drag & drop audio files (accepts multiple, any audio format)
  - Shows "(default)" when no custom clips are uploaded
  - Removing all custom clips restores the default sound

---

## Adding Voice Lines

### Via Settings UI (recommended)

1. Open **Settings → Sound**
2. Expand a sound category (Entry Filled, Target Filled, Stop Filled)
3. Click the upload zone or drag audio files into it
4. Clips are stored in IndexedDB and persist across sessions

### Adding a New Sound Category

1. Add the category name to the `SoundName` union type in `audioService.ts`
2. Add it to the `SOUND_NAMES` array
3. Place a default `1.mp3` in `frontend/public/sounds/{category}/`
4. Add a trigger call (`audioService.play('new_name')`) at the appropriate event handler
5. Add a row to the `SOUNDS` array in `SoundTab.tsx`
