# Feature: Bracket Order Settings

Modal dialog for configuring bracket presets — stop loss, multiple take-profit levels, and rule-based conditions (e.g. "when TP 1 fills, move SL to breakeven").

**Status**: Implemented

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  New Bracket Preset                              ✕  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  PRESET NAME                                        │
│  ┌───────────────────────────────────────────────┐  │
│  │  Scalp 10-point / Runner                      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  STOP LOSS                                          │
│  Distance (Points)     Order Type                   │
│  ┌────────────┐        ┌─────────────────┐          │
│  │  4         │        │  Stop Market  ▼ │          │
│  └────────────┘        └─────────────────┘          │
│                                                     │
│  TAKE PROFITS                          + ADD TARGET │
│  ┌──────────────────────────────────────────────┐   │
│  │  1   Points ___20___   Quantity ___1___    ✕ │   │
│  │  2   Points ___40___   Quantity ___1___    ✕ │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  AUTOMATION                              + NEW RULE │
│  WHEN  [ Target 1 is filled ▼ ]                ✕   │
│  THEN  [ Move SL to Breakeven ▼ ]                  │
│                                                     │
│  Reset  Delete              Discard  [ Save Preset ]│
└─────────────────────────────────────────────────────┘
```

- **Width**: `w-[480px]`, `max-h-[85vh]`
- **Background**: `bg-black`, border `border-white/5`, `rounded-2xl`
- **Overlay**: `bg-black/60`

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/order-panel/BracketSettingsModal.tsx` | Modal, StopLossSection, TakeProfitList, TakeProfitRow, ConditionList, ConditionRow |
| `frontend/src/types/bracket.ts` | BracketConfig, StopLossConfig, TakeProfitLevel, Condition types |
| `frontend/src/store/slices/tradingSlice.ts` | Bracket presets state, `editingPresetId`, `activePresetId` (in `tradingSlice`) |

---

## Data Model

```ts
interface StopLossConfig {
  points: number;
  type: 'Stop' | 'TrailingStop';  // maps to API type 4 | 5
}

interface TakeProfitLevel {
  id: string;         // crypto.randomUUID()
  points: number;     // distance in points from entry
  size: number;       // contract count (absolute, not percentage)
}

type ConditionTrigger =
  | { kind: 'tpFilled'; tpIndex: number }       // fire when TP N fills
  | { kind: 'profitReached'; points: number };   // fire when unrealized profit >= N points

type ConditionAction =
  | { kind: 'moveSLToBreakeven' }
  | { kind: 'moveSLToPrice'; points: number }   // move SL to a specific point offset (aliased to customOffset in UI)
  | { kind: 'moveSLToTP'; tpIndex: number }
  | { kind: 'customOffset'; points: number }
  | { kind: 'cancelRemainingTPs' };

interface BracketCondition {
  id: string;
  trigger: ConditionTrigger;
  action: ConditionAction;
}

interface BracketConfig {
  stopLoss: StopLossConfig;
  takeProfits: TakeProfitLevel[];
  conditions: BracketCondition[];
}

interface BracketPreset {
  id: string;
  name: string;
  config: BracketConfig;
}
```

---

## Components

### `BracketSettingsModal`
Top-level modal. Uses the shared `<Modal>` component (`shared/Modal.tsx`) for backdrop, Escape key, and click-outside behavior. Opens when `editingPresetId` is set in the store (`'new'` for create, preset ID for edit). Uses draft-based editing — clones config on open, writes back on save. **Note**: this modal uses its own `bg-white/[0.05]` input style (intentionally different from `INPUT_DARK`) — do not replace with the shared input constants.

- **Header**: title + close button (round `hover:bg-white/5`), `padding: 18px 24px`
- **Body**: scrollable, `padding: 20px 24px`, sections separated by `gap: 28px`
- **Footer**: Reset / Delete (left), Discard / Save Preset (right), `padding: 16px 24px`
- **Input style**: `bg-white/[0.05] border border-white/10 rounded-lg`, focus `border-[#2962ff]/50`
- **Select style**: same as input + custom `ChevronDown` SVG overlay, native `<select>` with `appearance-none`
- **Section labels**: `text-[11px] font-medium text-[#787b86] uppercase tracking-wider`
- **Save button**: `bg-[#2962ff]/20 text-[#5b8def]` (muted dark blue)

### `StopLossSection`
- "Distance (Points)" input (min 0) + "Order Type" dropdown (Stop Market / Trailing Stop)
- Side-by-side `grid grid-cols-2` layout, `gap: 12px`

### `TakeProfitList`
- Renders `TakeProfitRow` per level, `gap: 8px`
- "+ Add Target" button (max `MAX_TP_LEVELS` = 8)

### `TakeProfitRow`
- Card row: `bg-white/[0.04] border border-white/[0.05] rounded-lg`, hover `border-white/10`
- Layout: index number + "Points" underline input + "Quantity" underline input + hover-reveal ✕ button
- Underline inputs: `bg-transparent border-b border-white/10`, focus `border-white/30`
- Labels `text-[11px] text-[#787b86]`

### `ConditionList`
- Renders `ConditionRow` per rule, `gap: 12px`
- "+ New Rule" always enabled — defaults to `profitReached` when no TPs exist, `tpFilled` otherwise

### `ConditionRow`
- **When** row: `WHEN` label (36px wide) + two-part trigger:
  - Trigger kind dropdown: "Target filled" (hidden when no TPs) / "Profit reached"
  - Sub-input: TP index dropdown (for `tpFilled`) or points input + "pts profit" label (for `profitReached`)
- **Then** row: `THEN` label (36px wide) + full-width action dropdown
- Labels `text-[11px] text-[#787b86] font-medium uppercase`
- Selects `padding: 8px 12px`, `text-xs`
- Action options built dynamically from TP count:
  - Move SL to Breakeven
  - Move SL to Target N price (for each TP != trigger TP)
  - Move SL to custom offset (reveals points input + "points past entry" label)
  - Cancel remaining targets

---

## Store State

```ts
// In useStore
bracketPresets: BracketPreset[];    // persisted to localStorage
activePresetId: string | null;      // currently selected preset
editingPresetId: string | null;     // 'new' or preset ID → opens modal
```

---

## Validation

| Rule | Detail |
|------|--------|
| Preset name required | `name.trim().length > 0` |
| SL ≥ 1 when TPs exist | SL points must be at least 1 if any TPs are set |
| TP points ≥ 1 | Required per level |
| TP size ≥ 1 | Required per level |
| Condition trigger TP exists | `tpIndex < takeProfits.length` (tpFilled only) |
| Profit threshold ≥ 1 | Required for `profitReached` triggers |

Errors shown as red pills, warnings (TP size sum) as yellow pills. Save disabled when errors exist.

---

## Runtime Execution

Conditions are evaluated client-side by `BracketEngine` — NOT sent to the API:

**TP-fill triggers** — evaluated on SignalR order fill events:
```
SignalR GatewayUserOrder event (status=2, filled)
  └─► BracketEngine.onOrderEvent()
        └─► if filled order matches a TP → evaluate matching tpFilled conditions
```

**Price-based triggers** — evaluated on every lastPrice tick via Zustand store subscription:
```
useStore lastPrice change
  └─► BracketEngine.onPriceUpdate()
        └─► if profitPoints >= threshold → fire action (one-shot)
```
