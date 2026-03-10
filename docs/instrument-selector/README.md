# Instrument Selector

## Overview

A popover-based instrument picker with hierarchical filtering by **category** and **exchange**. Replaces the current inline input dropdown with a richer UI that surfaces instrument metadata and prepares the app for multi-exchange support.

---

## Current State

- Single exchange: **ProjectX**
- Single category: **Futures**
- **Chart toolbar**: Uses `InstrumentSelectorPopover` — popover with search, category/exchange filters, and instrument metadata rows
- **Order panel**: Uses `InstrumentSelector` (original inline `<input>` + dropdown, `fixed` mode)

### Key Files

| File | Role |
|------|------|
| `frontend/src/components/InstrumentSelectorPopover.tsx` | Popover selector (chart toolbar) |
| `frontend/src/components/InstrumentSelector.tsx` | Inline selector (order panel, `fixed` mode) |
| `frontend/src/hooks/useInstrumentSearch.ts` | Shared hook: debounced search, bookmark resolution, `isBookmarked`, `toggleBookmark` |
| `frontend/src/services/marketDataService.ts` | `Contract` interface, `searchContracts()` API |
| `frontend/src/utils/instrument.ts` | Tick/point/P&L helpers |

Both selectors share `useInstrumentSearch` for data/logic (debounced search, bookmarks) and `useClickOutside` for close-on-blur. Their **UI is intentionally different** — do not merge the visual implementations.

---

## Implemented Design (Chart Toolbar)

### Popover Layout

```
┌──────────────────────────────────────────┐
│  [  Search instrument...              ]  │
│                                          │
│  Futures  Perpetuals  Spot  Stocks  CFD  │   ← category row (always visible)
│  ────────                                │
│  ProjectX   Rithmic                      │   ← exchange row (visible when category selected)
│  ─────────                               │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  ★  NQM6                        │    │
│  │     E-mini Nasdaq 100 Futures    │    │
│  │     Futures · ProjectX           │    │
│  ├──────────────────────────────────┤    │
│  │  ★  ESM6                        │    │
│  │     E-mini S&P 500 Futures       │    │
│  │     Futures · ProjectX           │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### Filter Behaviour

- **Two-row filter**: category row is always visible on top; exchange row appears below once a category is selected.
- Selecting a category scopes the instrument list (and search) to that category.
- Selecting an exchange further narrows within the active category.
- Categories/exchanges with no available data are shown **disabled** with a "Coming soon" visual treatment (`opacity-50`, no hover effect).
- Search query always filters within the currently active category + exchange scope.

### Static Metadata (Phase 1)

Since only one exchange/category exists today, the filter data is a local constant — no API changes required:

```ts
const CATEGORIES = [
  { id: 'futures',    label: 'Futures',    exchanges: ['ProjectX'], disabled: false },
  { id: 'perpetuals', label: 'Perpetuals', exchanges: [],           disabled: true  },
  { id: 'spot',       label: 'Spot',       exchanges: [],           disabled: true  },
  { id: 'stocks',     label: 'Stocks',     exchanges: [],           disabled: true  },
  { id: 'cfd',        label: 'CFD',        exchanges: [],           disabled: true  },
];
```

When a new exchange is added, it gets appended to the relevant category's `exchanges` array and its adapter is wired up.

### Instrument Row Metadata

Each row in the results list shows:
- **Bookmark star** (existing)
- **Contract name** (e.g. `NQM6`)
- **Description** (e.g. `E-mini Nasdaq 100 Futures`)
- **Category + Exchange tag** (e.g. `Futures · ProjectX`) — small muted text

---

## Styling Rules

All styles follow the project design tokens (see root `README.md`):

| Element | Value |
|---------|-------|
| Popover background | `bg-black` |
| Popover border | `border-[#2a2e39]` |
| Filter tab (inactive) | `text-[#787b86]` |
| Filter tab (active) | `text-white`, underline or `bg-[#1e222d]` pill |
| Filter tab (disabled) | `opacity-50`, no pointer events |
| Row hover | `hover:bg-[#1e222d]` |
| Active row | `bg-[#1e222d]`, name in `text-[#f0a830]` |
| Metadata tag | `text-[10px] text-[#787b86]` |
| Search input bg | `bg-[#111]` |
| Transitions | All interactive states animated (`transition-colors`) |
| Popover entrance | Fade/slide in (existing `animate-dropdown-in`) |

---

## Scope

### Done
- Popover with search + two-row category/exchange filters (chart toolbar)
- Instrument rows with category + exchange metadata
- Disabled "Coming soon" state for unavailable categories
- Bookmark (pin) functionality carried over
- Order panel keeps original inline selector

### Out of scope (future)
- Dynamic category/exchange data from API
- Multi-exchange adapters (Rithmic, etc.)
- Changes to the `Contract` data model
- Exchange name on chart symbol display overlay
