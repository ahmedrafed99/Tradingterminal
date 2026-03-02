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
│  │  Scalp                                        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  STOP LOSS                                          │
│  ┌───────────────────────────────────────────────┐  │
│  │  Distance         Type                        │  │
│  │  [ 4 ] pts        [ Stop ▼ ]                  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  TAKE PROFITS                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  TP1  [ 20 ] pts  [ 1 ] ct              ✕    │  │
│  │  TP2  [ 40 ] pts  [ 1 ] ct              ✕    │  │
│  │  + Add Take Profit                            │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  CONDITIONS                                         │
│  ┌───────────────────────────────────────────────┐  │
│  │  When  [ TP 1 filled ▼ ]                 ✕    │  │
│  │  Then  [ Move SL to Breakeven ▼ ]             │  │
│  │  + Add Condition                              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  TP sizes sum to 2 contracts                        │
│                                                     │
│  Reset  Delete              Cancel  [ Save ]        │
└─────────────────────────────────────────────────────┘
```

- **Width**: `w-[520px]`, `max-h-[85vh]`
- **Background**: `bg-[#1e222d]`, border `border-[#2a2e39]`, `rounded-xl`
- **Overlay**: `bg-black/60`

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/components/order-panel/BracketSettingsModal.tsx` | Modal, StopLossSection, TakeProfitList, TakeProfitRow, ConditionList, ConditionRow |
| `frontend/src/types/bracket.ts` | BracketConfig, StopLossConfig, TakeProfitLevel, Condition types |
| `frontend/src/store/useStore.ts` | Bracket presets state, `editingPresetId`, `activePresetId` |

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

type ConditionTrigger = { kind: 'tpFilled'; tpIndex: number };

type ConditionAction =
  | { kind: 'moveSLToBreakeven' }
  | { kind: 'moveSLToTP'; tpIndex: number }
  | { kind: 'customOffset'; points: number }
  | { kind: 'cancelRemainingTPs' };

interface Condition {
  id: string;
  trigger: ConditionTrigger;
  action: ConditionAction;
}

interface BracketConfig {
  stopLoss: StopLossConfig;
  takeProfits: TakeProfitLevel[];
  conditions: Condition[];
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
Top-level modal. Opens when `editingPresetId` is set in the store (`'new'` for create, preset ID for edit). Uses draft-based editing — clones config on open, writes back on save.

- **Header**: title + close button, `padding: 24px 36px`
- **Body**: scrollable, `padding: 28px 36px`, sections separated by `space-y-7`
- **Footer**: Reset / Delete (left), Cancel / Save (right), `padding: 24px 36px`

### `StopLossSection`
- Distance input (points, min 0) + Type dropdown (Stop / Trailing Stop)
- Side-by-side layout with `flex items-end gap-4`
- Card: `bg-[#131722]`, `padding: 14px 16px`

### `TakeProfitList`
- Renders `TakeProfitRow` per level, `space-y-2.5`
- "+ Add Take Profit" button (max `MAX_TP_LEVELS` = 8)

### `TakeProfitRow`
- Compact inline row: `TP1 [pts input] pts [size input] ct ✕`
- Input widths: `w-16` (points), `w-14` (size), `padding: 5px 8px`
- All text `text-xs` / `text-[10px]`

### `ConditionList`
- Renders `ConditionRow` per rule, `space-y-3`
- "+ Add Condition" disabled when no TPs exist

### `ConditionRow`
- **When** row: label + trigger dropdown (natural width, not full-width)
- **Then** row: label + action dropdown (natural width)
- Labels `text-[10px]` with fixed `w-8`
- Dropdowns `padding: 5px 8px`, `text-xs`
- Separated by `border-b border-[#2a2e39]`
- Action options built dynamically from TP count:
  - Move SL to Breakeven
  - Move SL to TP N price (for each TP != trigger TP)
  - Move SL to custom offset (reveals points input)
  - Cancel remaining TPs

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
| Condition trigger TP exists | `tpIndex < takeProfits.length` |

Errors shown as red pills, warnings (TP size sum) as yellow pills. Save disabled when errors exist.

---

## Runtime Execution

Conditions are evaluated client-side by `BracketEngine` listening to SignalR order events — NOT sent to the API:

```
SignalR GatewayUserOrder event (status=2, filled)
  └─► BracketEngine.onOrderEvent()
        └─► if filled order matches a TP
              └─► evaluate all Conditions where trigger.tpIndex matches
                    moveSLToBreakeven → modify SL order price to entry price
                    moveSLToTP        → modify SL order price to TP N price
                    customOffset      → modify SL order price to entry ± points
                    cancelRemainingTPs → cancel all remaining TP orders
```
