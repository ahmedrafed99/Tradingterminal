# ProjectX Chart Trading App

A localhost web app for trading on a candlestick chart using the
[ProjectX Gateway API](https://gateway.docs.projectx.com/docs/intro).

---

## Documentation Guide

### Folder Map

All feature documentation lives in `docs/`. Each subfolder has a `README.md`.

```
docs/
├── api-layer/            — REST + SignalR services, backend exchange adapter
├── api-settings/         — Settings modal, API credentials
├── top-bar/              — Account selector, balance, UP&L, RP&L, latency
├── candlestick-chart/    — Chart core: bars, toolbar, crosshair, primitive z-order
│   ├── ohlc-tooltip/     — OHLC hover tooltip
│   ├── bar-countdown/    — Current bar time remaining
│   ├── go-to-now/        — Floating scroll-to-latest button
│   ├── symbol-display/   — Instrument label overlay
│   └── indicators/
│       └── volume-profile/ — Session volume profile (GatewayDepth)
├── chart-settings-menu/  — Gear button, quick popover, full settings modal
├── color-palette-rules/  — Visual design token reference + refactor plan
├── chart-trading/        — + button, order lines, preview overlay, drag, labels
├── chart-screenshot/     — Screenshot capture + clipboard
├── chart-layout/         — Dual chart + crosshair sync
├── drawing-tools/        — HLine, oval, arrow path, renderers, templates
│   └── undo/             — Ctrl+Z undo stack for drawings
├── order-panel/          — Order entry sidebar, market/limit, buy/sell
│   └── bracket-settings/ — Preset UI: SL, multi-TP, conditions
├── bracket-engine/       — Runtime SL/TP placement after fill, condition evaluation
├── bottom-panel/         — Orders + Trades tabs, trade zone visualization
├── chat-bot/             — AI chat panel with tool use
├── conditional-orders/   — Candle-close triggered orders
├── database/             — Local SQLite for 1-min candles
├── instrument-selector/  — Popover instrument picker with filters
├── journal/              — Trade journaling with screenshots
├── news-display/         — Economic calendar + chart markers
├── settings-persistence/ — File-based settings backup (survives cache clears)
└── frontend/             — Full index: all components, services, store slices, types
```

### Quick Lookup

| I want to understand...                     | Go to |
|---------------------------------------------|-------|
| The + button on the price scale             | `docs/chart-trading/` → Plus Button |
| How order lines appear on the chart         | `docs/chart-trading/` → Live Order & Position Lines |
| Preview ghost lines (SL/TP/Entry)           | `docs/chart-trading/` → Preview Overlay |
| Drag-to-modify order prices                 | `docs/chart-trading/` → Drag-to-Modify |
| Overlay labels (P&L, size, cancel)          | `docs/chart-trading/` → Overlay Label System |
| How SL/TP are placed after entry fill       | `docs/bracket-engine/` |
| Bracket preset configuration UI             | `docs/order-panel/bracket-settings/` |
| How realized P&L is calculated              | `docs/top-bar/` → Centre — Realized P&L |
| How unrealized P&L is calculated            | `docs/top-bar/` → Centre — Balance + UP&L |
| Drawing renderers and hit testing           | `docs/drawing-tools/` |
| Volume profile data source (GatewayDepth)   | `docs/candlestick-chart/indicators/volume-profile/` |
| Chart screenshot / clipboard                | `docs/chart-screenshot/` |
| Dual chart layout + crosshair sync          | `docs/chart-layout/` |
| Crosshair price label + primitive z-order   | `docs/candlestick-chart/` → Price Scale Primitives |
| Orders and Trades tabs                      | `docs/bottom-panel/` |
| Trade zone visualization (FIFO matching)    | `docs/bottom-panel/` (chart primitive in `frontend/`) |
| Chart settings gear + modal                 | `docs/chart-settings-menu/` |
| Design tokens / colour palette rules        | `docs/color-palette-rules/` |
| Settings persistence / file backup          | `docs/settings-persistence/` |
| All Zustand store slices (7 domain slices)  | `docs/frontend/` → Zustand Store |
| All service API signatures                  | `docs/frontend/` → Service Layer |
| Shared components (Modal, TabButton, icons) | `docs/frontend/` → Shared Components |
| Design token constants (colors.ts, styles.ts)| `docs/frontend/` → Constants |
| Shared hooks (useClickOutside, etc.)        | `docs/frontend/` → Shared Hooks |
| Shared utilities (formatters, dedup, etc.)  | `docs/frontend/` → Shared Utilities |
| Realtime adapter interface + hub events      | `docs/frontend/` → realtimeService.ts / adapters/ |
| Ad-hoc brackets (+SL/+TP, no preset)       | `docs/chart-trading/` → Ad-Hoc Brackets |
| Position drag-to-create SL/TP              | `docs/chart-trading/` → Position Drag-to-Create |
| Conditional orders (candle-close triggers)  | `docs/conditional-orders/` |
| Condition deployment (Render / Docker)      | `docs/conditional-orders/` → Deployment |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (localhost:5173)                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     React Application                        │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  Top Bar                                             │   │   │
│  │  │  • Account selector  • Balance / UP&L / RP&L         │   │   │
│  │  │  • Connection status • Latency      • Settings       │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐   │   │
│  │  │   CandlestickChart      │  │       OrderPanel        │   │   │
│  │  │  ─────────────────────  │  │  ─────────────────────  │   │   │
│  │  │  • OHLCV rendering      │  │  • Market / Limit tabs  │   │   │
│  │  │  • Timeframe selector   │  │  • Buy / Sell buttons   │   │   │
│  │  │  • + button (quick      │  │  • Instrument selector  │   │   │
│  │  │    limit order)         │  │  • Contracts spinner    │   │   │
│  │  │  • Order price lines    │  │  • Bracket settings ⚙   │   │   │
│  │  │    (drag to modify)     │  │  • Preview checkbox     │   │   │
│  │  │  • ✕ cancel per order   │  │  • Position / P&L       │   │   │
│  │  │  • Preview ghost lines  │  └─────────────────────────┘   │   │
│  │  │  • Drawing tools        │                                 │   │
│  │  └─────────────────────────┘                                 │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  Bottom Panel                                        │   │   │
│  │  │  • Orders tab (open orders table)                    │   │   │
│  │  │  • Trades tab (session fills + trade zone overlay)   │   │   │
│  │  │  • Conditions tab (candle-close conditional orders)  │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  Zustand Store (7 domain slices)                     │   │   │
│  │  │  connection | instrument | trading | drawings        │   │   │
│  │  │  layout | conditions | toast                         │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  API Service Layer                                    │   │   │
│  │  │  authService · marketDataService · orderService      │   │   │
│  │  │  accountService · realtimeService (adapter facade)   │   │   │
│  │  │  bracketEngine (client-side SL/TP management)        │   │   │
│  │  │  conditionService (remote condition server client)   │   │   │
│  │  └──────────────┬───────────────────────────────────────┘   │   │
│  └─────────────────┼───────────────────────────────────────────┘   │
└────────────────────┼────────────────────────────────────────────────┘
                     │ HTTP / WebSocket
┌────────────────────▼────────────────────────────────────────────────┐
│         Node.js / Express Proxy  (localhost:3001)                    │
│  • JWT held in memory — never exposed to browser                    │
│  • CORS locked to localhost:5173                                     │
│  • Zod validation on all routes                                      │
│  • Exchange adapter pattern: routes call getAdapter().domain.method()│
│  • ProjectX adapter: REST calls + SignalR WS proxy (JWT injected)   │
└────────────────────┬────────────────────────────────────────────────┘
                     │ HTTPS / WSS
┌────────────────────▼────────────────────────────────────────────────┐
│         ProjectX Gateway API  (api.topstepx.com)                       │
│                                                                      │
│  REST endpoints                   SignalR Hubs (rtc.topstepx.com)    │
│  ────────────────────────         ─────────────────────────         │
│  POST /api/Auth/loginKey          /hubs/market  → quotes            │
│  POST /api/History/retrieveBars   /hubs/user   → orders/positions   │
│  POST /api/Contract/search                                           │
│  POST /api/Contract/available                                        │
│  POST /api/Order/place                                               │
│  POST /api/Order/cancel                                              │
│  POST /api/Order/modify                                              │
│  POST /api/Order/searchOpen                                          │
│  POST /api/Account/search                                            │
│  POST /api/Trade/search                                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Library |
|-------|---------|
| Frontend | React 18 + TypeScript + Vite |
| Chart | Lightweight Charts v5 (TradingView OSS) |
| State | Zustand (7 domain slices, persisted to localStorage + backend JSON file) |
| Styling | Tailwind CSS |
| Typography | System font stack: `-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif` |
| Backend proxy | Node.js + Express |
| Real-time | @microsoft/signalr (isolated in ProjectX adapter) |

---

## Design Tokens

Canonical color and style values. **Do not add new values — pick from this table.**

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| Page / chart canvas | `#131722` | `body`, chart background, loading overlays |
| Panel / toolbar | `#000000` | TopBar, ChartToolbar, OrderPanel, BottomPanel |
| Input / control | `#111` | All text inputs, selects, spinners, summary boxes |
| Modal panel | `#1e222d` | SettingsModal, BracketSettingsModal panel |
| Hover row | `#1e222d` | Dropdown items, list rows on hover |
| Toolbar button hover | `#363a45` | DrawingEditToolbar, icon button hover |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#d1d4dc` | Body text, data values, OHLC |
| Muted | `#787b86` | Labels, secondary info, icons at rest |
| Dim | `#434651` | Empty states, placeholders, crosshair lines |
| Bright | `#ffffff` | Modal titles, active button text |

### Semantic

| Token | Value | Usage |
|-------|-------|-------|
| Primary action | `#2962ff` | Connect button, checkboxes, selection rings |
| Active accent | `#f0a830` | Active timeframe, active preset, active account |
| Profit / long | `#26a69a` | Positive P&L, BUY side, long positions |
| Loss / short | `#ef5350` | Negative P&L, SELL side, short positions |

### Borders & Dividers

| Token | Value |
|-------|-------|
| All borders | `#2a2e39` |
| Focus ring | `#1a3a6e` |

### Interactive States

| State | Rule |
|-------|------|
| Hover | Always animated — `transition-colors` on every interactive element |
| Disabled | `disabled:opacity-50 disabled:cursor-not-allowed` |
| Modal backdrop | `bg-black/60` |
| Dropdown shadow | `0 4px 24px rgba(0,0,0,0.5)` |

### Typography

| Token | Value |
|-------|-------|
| Font stack | `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif` |
| Section label | `text-[10px] uppercase tracking-wider text-[#787b86]` |
| Body text | `text-xs` (12px) |
| Button text | `text-[11px]` |
| Modal title | `text-sm font-semibold text-white` |

---

## Bracket Strategy

The app uses a **dual-path** bracket strategy depending on the number of take-profit levels. **SL is always attached as a native bracket** on the entry order for zero-latency protection.

- **0-1 TPs**: Uses **gateway-native brackets** — SL and TP are attached atomically to the entry order (zero latency gap). Requires "Auto OCO Brackets" enabled on the account. Gateway handles OCO auto-cancel.
- **2+ TPs**: **SL is still native** (attached to entry order), but TPs are placed by the **client-side bracket engine** after fill (detected via SignalR). The engine discovers the gateway-created SL order to manage it (resize on TP fills, move on conditions). Conditions (e.g. "move SL to breakeven when TP 1 hits") are evaluated client-side.

See `docs/bracket-engine/README.md` for the full runtime lifecycle.

---

## Quick Start

```bash
npm install          # installs root workspace deps
npm run dev          # starts both Vite (port 5173) and Express (port 3001)
```

Open `http://localhost:5173`, click the settings icon, enter your API key, and connect.
