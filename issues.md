# Error Handling Issues

Audit of try-catch blocks across the codebase. All items below need proper error handling.

---

## Critical — Silent Error Swallowing (`.catch(() => {})`)

### Frontend

- [x] **App.tsx** (lines 91, 103, 117, 134) — Contract search, order contract setup, session trades fetch
- [x] **OrderPanel.tsx** (lines 128, 221, 237, 248, 382) — Position fetch, order refresh/modify, last price fetch
- [x] **ChartArea.tsx** (line 46) — MNQ contract auto-load
- [x] **ConditionsTab.tsx** (line 79) — Initial conditions fetch
- [x] **TradesTab.tsx** (lines 67, 95, 120) — Trades fetch and count computation
- [x] **TopBar.tsx** (line 96) — Account search
- [x] **useSettingsSync.ts** (lines 73, 100, 122) — Settings persistence (including page unload)

### Backend

- [x] **barAggregator.ts** (line 221) — Initial poll on startup
- [x] **backfillService.ts** (lines 328, 331) — Auto-sync startup and periodic sync
- [x] **databaseService.ts** (lines 296, 299) — Auto-backup startup and periodic backup

---

## Warning — DEV-Only Logging (Silent in Production)

- [x] **OrderPanel.tsx** (lines 62-63, 143) — Trade fetch for position inference, order REST fetch — removed DEV gate

---

## Warning — Comment-Only Catch Bodies

- [x] **ConditionsTab.tsx** (lines 112-113, 124-125) — `// toast handled by SSE`, `// stay in list on failure`
- [x] **DatabaseTab.tsx** (lines 34-36, 59-61, 80-82, 108, 115) — Multiple `// silent` blocks
