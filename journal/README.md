# Trade Journal

A built-in trade journaling system that lets you capture, annotate, and review trades with minimal friction. The core idea: you already see your trades in the bottom panel — journaling should be one click away.

---

## User Flow

### Capturing a Journal Entry

```
Trades Tab → click a trade row → trade plots on chart
  → click "Add to Journal" button (new, appears on selected trade row)
  → Journal Entry Modal opens:
      ├── Chart screenshot (auto-captured with trade zone markers visible)
      ├── Auto-filled trade metadata (read-only summary)
      ├── User fields: setup type, notes, emotional state, tags, rating
      └── [Save] → entry + screenshot persisted to disk
```

### Reviewing the Journal

```
Journal page (new route: /journal)
  ├── Dashboard tab: calendar heatmap, equity curve, key stats
  └── Entries tab: filterable list of past entries with screenshot thumbnails
```

---

## Journal Entry Data Model

```typescript
interface JournalEntry {
  id: string;                  // UUID
  createdAt: string;           // ISO 8601 — when the entry was saved

  // Auto-filled from trade data
  trade: {
    tradeIds: number[];        // one or more trade IDs (supports partial-exit groups)
    symbol: string;            // e.g. "MNQH6"
    side: 'Long' | 'Short';
    qty: number;
    entryPrice: number;
    exitPrice: number;
    entryTime: string;         // ISO 8601
    exitTime: string;          // ISO 8601
    duration: number;          // milliseconds
    pnl: number;              // raw P&L
    fees: number;
    net: number;               // pnl - fees
    session: 'Asia' | 'London' | 'New York' | 'Other';
  };

  // Auto-captured
  screenshotFilename: string;  // reference to PNG in journal-screenshots/

  // User-provided
  setupType: string;           // from predefined list or custom
  notes: string;               // free-form markdown text
  emotion: 'Confident' | 'Neutral' | 'Anxious' | 'Tilted' | 'Revenge' | 'FOMO';
  tags: string[];              // user-defined tags, e.g. ["A+ setup", "news play"]
  rating: number | null;       // 1-5 stars, optional
}
```

### Setup Types (predefined, user can add custom)

Default list: `Breakout`, `Reversal`, `Scalp`, `Trend Continuation`, `News / Event`, `Range`, `Fade`, `Other`

---

## Screenshot Capture

Reuses the existing `chartRegistry` screenshot infrastructure:

1. When "Add to Journal" is clicked, ensure the trade's zone is visible on the chart
2. Call `chart.takeScreenshot()` with trade zone markers enabled
3. Render the screenshot into the modal as a preview
4. On save, send the screenshot blob to the backend for disk storage

The screenshot shows exactly what the user sees: candles, trade entry/exit markers, zone overlay, drawings (optional toggle in modal).

---

## Storage

### Backend

New route group: `/journal`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/journal/entries` | Create entry (multipart: JSON metadata + PNG screenshot) |
| GET | `/journal/entries` | List entries (query params: `from`, `to`, `symbol`, `setupType`, `tags`) |
| GET | `/journal/entries/:id` | Get single entry |
| PUT | `/journal/entries/:id` | Update entry metadata (notes, tags, rating, etc.) |
| DELETE | `/journal/entries/:id` | Delete entry + its screenshot file |
| GET | `/journal/entries/:id/screenshot` | Serve screenshot PNG |
| GET | `/journal/stats` | Computed stats for dashboard (query params: `from`, `to`) |

### File Structure

```
backend/
  data/
    journal/
      entries.json          # array of JournalEntry objects
      screenshots/
        {entry-id}.png      # one PNG per entry
```

`entries.json` is the single source of truth. Loaded into memory on server start, written on mutations (same pattern as settings persistence).

---

## Frontend Components

### 1. "Add to Journal" Button

**Location:** Trade row in `TradesTab.tsx`

- Appears on the currently selected (highlighted) trade row
- Small button: journal/bookmark icon + "Journal" text
- For multi-exit groups: button appears on the parent row, captures the full trade group
- Disabled with tooltip if the trade is already journaled (check by tradeId match)

### 2. Journal Entry Modal

**Trigger:** "Add to Journal" button click

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  Journal Entry                                     [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │          Chart Screenshot Preview               │   │
│  │          (auto-captured, read-only)             │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  TRADE SUMMARY                                          │
│  MNQH6 · Long · 2 contracts                            │
│  Entry 21,450.25 → Exit 21,462.50 · Duration 3m 12s    │
│  P&L +$49.00 · Fees $4.20 · Net +$44.80                │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Setup Type     [Breakout         ▾]                    │
│                                                         │
│  Emotion        [Confident ▾]                           │
│                                                         │
│  Rating         ★ ★ ★ ☆ ☆                              │
│                                                         │
│  Tags           [A+ setup] [x]  [trend] [x]  [+ Add]   │
│                                                         │
│  Notes                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Clean breakout above consolidation range.       │   │
│  │ Entered on the retest of the breakout level.    │   │
│  │ Could have held longer — exited too early.      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│                              [Cancel]  [Save to Journal]│
└─────────────────────────────────────────────────────────┘
```

**Styling:** follows existing modal conventions — `bg-[#1e222d]` panel, `bg-black/60` backdrop, `#2a2e39` borders, `transition-colors` on all interactive elements.

### 3. Journal Page (`/journal`)

Full-page route, two sub-tabs: **Dashboard** and **Entries**.

#### Dashboard Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  Journal Dashboard                    [Date Range: Last 30d ▾]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PERFORMANCE                                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ Trades  │ │ Win Rate│ │ Avg Win │ │ Avg Loss│ │  Net P&L│ │
│  │   47    │ │  61.7%  │ │ +$38.20 │ │ -$22.10 │ │+$842.60 │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│                                                                 │
│  EQUITY CURVE                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  $900 ─                                          ╱──    │   │
│  │  $600 ─                              ╱──────────╱       │   │
│  │  $300 ─              ╱──────╲───────╱                   │   │
│  │    $0 ─ ────────────╱                                   │   │
│  │        Feb 1    Feb 8    Feb 15    Feb 22    Mar 1       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  CALENDAR                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │      Mon    Tue    Wed    Thu    Fri                     │   │
│  │ W1   +120   -45    +80     —    +65                     │   │
│  │ W2   -30    +95    +110   -20   +45                     │   │
│  │ W3    —     -60    -15    +130  +90                     │   │
│  │ W4   +55    +40    -35    +70    —                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  Cells colored by P&L intensity. Click a day to jump to entries.│
│                                                                 │
│  BREAKDOWN                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐           │
│  │ By Setup Type        │  │ By Emotion           │           │
│  │ Breakout    72% / 18 │  │ Confident   68% / 22 │           │
│  │ Reversal    55% / 11 │  │ Neutral     60% / 15 │           │
│  │ Scalp       40% / 10 │  │ FOMO        25% / 4  │           │
│  │ Other       50% / 8  │  │ Tilted      20% / 5  │           │
│  └──────────────────────┘  └──────────────────────┘           │
│  (win rate / trade count)                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Stats computed by the `/journal/stats` endpoint:**

```typescript
interface JournalStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;         // gross wins / gross losses
  totalNet: number;
  largestWin: JournalEntry;
  largestLoss: JournalEntry;
  currentStreak: { type: 'win' | 'loss'; count: number };
  longestWinStreak: number;
  longestLossStreak: number;
  bySetupType: Record<string, { wins: number; losses: number; net: number }>;
  byEmotion: Record<string, { wins: number; losses: number; net: number }>;
  bySession: Record<string, { wins: number; losses: number; net: number }>;
  byDayOfWeek: Record<string, { wins: number; losses: number; net: number }>;
  equityCurve: { date: string; cumulativeNet: number }[];
  calendarDays: { date: string; net: number; tradeCount: number }[];
}
```

#### Entries Tab

```
┌───────────────────────────────────────────────────────────────────┐
│  Journal Entries                                                  │
│  [Search...        ]  [Setup: All ▾]  [Tags ▾]  [Date Range ▾]  │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────┐  Mar 5, 2026 · 14:32 NY                               │
│  │ thumb│  MNQH6 Long · +$44.80 net · Breakout                  │
│  │  .png│  "Clean breakout above consolidation..."    ★★★        │
│  └──────┘  [Confident] [A+ setup] [trend]                        │
│  ─────────────────────────────────────────────────────────────── │
│  ┌──────┐  Mar 5, 2026 · 10:15 NY                               │
│  │ thumb│  MESH6 Short · -$22.10 net · Reversal                 │
│  │  .png│  "Tried to fade the move too early..."     ★★          │
│  └──────┘  [Anxious] [counter-trend]                             │
│  ─────────────────────────────────────────────────────────────── │
│  ...                                                              │
│                                                                   │
│  Click an entry to expand → full screenshot + notes              │
└───────────────────────────────────────────────────────────────────┘
```

**Expanded entry view:** shows full-size screenshot, complete notes, all metadata, and Edit / Delete buttons.

---

## Zustand Store Slice

```typescript
interface JournalSlice {
  // Data
  journalEntries: JournalEntry[];
  journalStats: JournalStats | null;

  // Filter state (for entries tab)
  journalDateRange: { from: string; to: string };
  journalSetupFilter: string | null;
  journalTagFilter: string[];
  journalSearchQuery: string;

  // Actions
  loadJournalEntries: () => Promise<void>;
  loadJournalStats: () => Promise<void>;
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'createdAt'>, screenshot: Blob) => Promise<void>;
  updateJournalEntry: (id: string, updates: Partial<JournalEntry>) => Promise<void>;
  deleteJournalEntry: (id: string) => Promise<void>;
  setJournalDateRange: (range: { from: string; to: string }) => void;
  setJournalSetupFilter: (setup: string | null) => void;
  setJournalTagFilter: (tags: string[]) => void;
  setJournalSearchQuery: (query: string) => void;
}
```

Not persisted to localStorage — data lives on disk via the backend.

---

## Navigation

Two options (decide during implementation):

**Option A — Bottom panel tab:** Add a "Journal" tab next to "Orders" and "Trades". Pro: discoverable, no routing changes. Con: limited vertical space for the dashboard.

**Option B — Full page route (recommended):** Add a small journal icon to the top bar that navigates to `/journal`. The dashboard and entry browser get the full viewport. The capture modal still lives in the trading view. This keeps the trading UI uncluttered while giving the journal room to breathe.

---

## Build Order

1. **Backend:** `/journal` CRUD routes, file storage for entries + screenshots
2. **Capture flow:** "Add to Journal" button in TradesTab, screenshot integration, entry modal
3. **Entries browser:** list view with filters, expanded entry view, edit/delete
4. **Dashboard:** stats endpoint, performance cards, equity curve, calendar heatmap, breakdowns

Each phase is independently useful — you can journal and review entries before the dashboard exists.

---

## Future Ideas (not in initial scope)

- **Bulk import:** journal all trades from a session in one click
- **Export:** CSV / PDF report generation
- **Comparison view:** side-by-side two entries to compare setups
- **AI review:** feed entries to an LLM for pattern analysis and weekly reports
- **Video replay:** ring-buffer screen recording (capture last 30s on hotkey)
- **Shared journals:** export an entry as a shareable image/link
