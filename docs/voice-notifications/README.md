# Voice Notifications

Plays pre-recorded voice clips on order fill events so the trader gets immediate audible feedback without watching the screen.

---

## Sound Files

Located in `frontend/public/sounds/` (served at `/sounds/` by Vite):

| File | Trigger |
|------|---------|
| `order_filled.mp3` | Entry order filled (market or limit) |
| `target_filled.mp3` | Take-profit limit order filled |
| `stop_filled.mp3` | Stop-loss order filled |

---

## Audio Service

**File:** `frontend/src/services/audioService.ts`

Singleton `audioService` that:
1. **Preloads** all three `.mp3` files as `HTMLAudioElement` instances on startup
2. **Exposes** `play(name)` — resets `currentTime` and plays (silently catches autoplay blocks)
3. **Persists** `enabled` (boolean) and `volume` (0–1) in `localStorage` key `sound-settings`

### API

```ts
audioService.play('order_filled' | 'target_filled' | 'stop_filled')
audioService.getEnabled() / setEnabled(boolean)
audioService.getVolume()  / setVolume(number)  // 0–1
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

Accessible via **Settings (gear icon) → Sound** tab in the top-right corner.

Controls:
- **On/Off toggle** — enables or disables all voice notifications
- **Volume slider** — 0–100% range, applied to all sounds
- **Test buttons** — one per sound, plays the clip regardless of enabled state

---

## Adding New Sounds

1. Drop a new `.mp3` file into `frontend/public/sounds/`
2. Add the filename (without extension) to the `SoundName` union type in `audioService.ts`
3. Add a trigger call (`audioService.play('new_sound')`) at the appropriate event handler
4. Add a row to the `SOUNDS` array in `SoundTab.tsx` for the test button
