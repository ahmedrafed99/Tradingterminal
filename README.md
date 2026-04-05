# Trading Terminal

A localhost web app for trading on a candlestick chart. Built on an adapter pattern for multi-exchange support.

**Supported exchanges:**
- [ProjectX (TopstepX)](https://gateway.docs.projectx.com/docs/intro) — CME futures

**Planned:**
- Hyperliquid — Crypto perpetuals, spot, tradfi (see `docs/exchange-adapters/hyperliquid.md`)

---

## Documentation Guide

### Folder Map

All feature documentation lives in `docs/`, organized by scope.

```
docs/
├── shared/                    — Exchange-agnostic features
│   ├── api-layer/             — REST + WebSocket services, backend exchange adapter
│   ├── top-bar/               — Account selector, balance, UP&L, RP&L, latency
│   ├── candlestick-chart/     — Chart core: bars, toolbar, crosshair, primitive z-order
│   │   ├── ohlc-tooltip/      — OHLC hover tooltip
│   │   ├── bar-countdown/     — Current bar time remaining
│   │   ├── go-to-now/         — Floating scroll-to-latest button
│   │   ├── symbol-display/    — Instrument label overlay
│   │   └── indicators/
│   │       ├── volume-profile/    — Session volume profile (GatewayDepth)
│   │       └── bid-ask-footprint/ — Per-candle bid/ask footprint (GatewayQuote)
│   ├── chart-settings-menu/   — Gear button, quick popover, full settings modal
│   ├── design-tokens/         — Color palette rules + UI tokens
│   ├── chart-trading/         — + button, order lines, preview overlay, drag, labels
│   ├── chart-screenshot/      — Screenshot capture + clipboard
│   ├── chart-layout/          — Dual chart + crosshair sync
│   ├── drawing-tools/         — HLine, oval, arrow path, free draw, renderers, templates
│   │   └── undo/              — Ctrl+Z undo stack for drawings
│   ├── order-panel/           — Order entry sidebar, market/limit, buy/sell
│   │   └── bracket-settings/  — Preset UI: SL, multi-TP, conditions
│   ├── bracket-engine/        — Runtime SL/TP placement after fill, condition evaluation
│   ├── bottom-panel/          — Orders + Trades tabs, trade zone visualization
│   ├── stats-dashboard/       — Stats popover: KPI cards, equity curve, PnL calendar
│   ├── chat-bot/              — AI chat panel with tool use
│   ├── conditional-orders/    — Candle-close triggered orders
│   ├── database/              — Local SQLite for 1-min candles
│   ├── instrument-selector/   — Popover instrument picker with category/exchange filters
│   ├── journal/               — Trade journaling with screenshots
│   ├── news-display/          — Economic calendar + chart markers
│   ├── settings-persistence/  — File-based settings backup (survives cache clears)
│   ├── video-recording/       — Chart video recording for journaling
│   ├── voice-notifications/   — Audible voice clips on order/TP/SL fills
│   ├── frontend/              — Full index: all components, services, store slices, types
│   └── refactor/              — Known architectural issues and cleanup priorities
│
├── futures/                   — Futures-specific features (ProjectX/TopstepX)
│   ├── api-settings/          — ProjectX connection settings, API credentials
│   ├── bot-trading/           — Bot drawing tools: HLine, markers, SSE transport, API
│   ├── claude-trader/         — Autonomous NQ trading system (tools, journal, state)
│   ├── claude-strategies/     — Backtested algorithmic strategies (London Sniper, etc.)
│   ├── trading-strategy/      — Price action reversal research (Origin method)
│   └── account-copier/        — Copy trading: master → follower trade mirroring
│
├── crypto/                    — Crypto-specific features
│   └── hyperliquid/           — Hyperliquid auth, API reference, order types, testnet
│
└── exchange-adapters/         — Adapter architecture + per-exchange docs
    ├── README.md              — How the adapter pattern works, how to add exchanges
    ├── projectx.md            — ProjectX adapter specifics
    └── hyperliquid.md         — Hyperliquid adapter specifics
```

### Quick Lookup

| I want to understand...                     | Go to |
|---------------------------------------------|-------|
| **Exchange & Adapter Architecture** | |
| How multi-exchange adapter pattern works    | `docs/exchange-adapters/` |
| ProjectX adapter specifics                  | `docs/exchange-adapters/projectx.md` |
| Hyperliquid adapter specifics               | `docs/exchange-adapters/hyperliquid.md` |
| Hyperliquid API reference                   | `docs/crypto/hyperliquid/` |
| ProjectX connection / API credentials       | `docs/futures/api-settings/` |
| **Chart & Trading** | |
| The + button on the price scale             | `docs/shared/chart-trading/` → Plus Button |
| How order lines appear on the chart         | `docs/shared/chart-trading/` → Live Order & Position Lines |
| Preview ghost lines (SL/TP/Entry)           | `docs/shared/chart-trading/` → Preview Overlay |
| Drag-to-modify order prices                 | `docs/shared/chart-trading/` → Drag-to-Modify |
| Overlay labels (P&L, size, cancel)          | `docs/shared/chart-trading/` → Overlay Label System |
| Ad-hoc brackets (+SL/+TP, no preset)       | `docs/shared/chart-trading/` → Ad-Hoc Brackets |
| Position drag-to-create SL/TP              | `docs/shared/chart-trading/` → Position Drag-to-Create |
| How SL/TP are placed after entry fill       | `docs/shared/bracket-engine/` |
| Bracket preset configuration UI             | `docs/shared/order-panel/bracket-settings/` |
| Drawing renderers and hit testing           | `docs/shared/drawing-tools/` |
| Chart screenshot / clipboard                | `docs/shared/chart-screenshot/` |
| Dual chart layout + crosshair sync          | `docs/shared/chart-layout/` |
| Crosshair price label + primitive z-order   | `docs/shared/candlestick-chart/` → Price Scale Primitives |
| Chart settings gear + modal                 | `docs/shared/chart-settings-menu/` |
| Volume profile data source (GatewayDepth)   | `docs/shared/candlestick-chart/indicators/volume-profile/` |
| Bid/Ask footprint (per-candle bid/ask bars) | `docs/shared/candlestick-chart/indicators/bid-ask-footprint/` |
| Session-only mode (always-on gap collapse)    | `docs/shared/candlestick-chart/` → Session-only mode |
| **Panels & UI** | |
| How realized P&L is calculated              | `docs/shared/top-bar/` → Centre — Realized P&L |
| How unrealized P&L is calculated            | `docs/shared/top-bar/` → Centre — Balance + UP&L |
| Orders and Trades tabs                      | `docs/shared/bottom-panel/` |
| Trade zone visualization (FIFO matching)    | `docs/shared/bottom-panel/` |
| Stats dashboard (KPI, equity curve, calendar)| `docs/shared/stats-dashboard/` |
| Instrument selector (categories, exchanges) | `docs/shared/instrument-selector/` |
| Conditional orders (candle-close triggers)  | `docs/shared/conditional-orders/` |
| Voice notifications on fills                | `docs/shared/voice-notifications/` |
| Chart video recording                       | `docs/shared/video-recording/` |
| News / economic calendar markers            | `docs/shared/news-display/` |
| Trade journal (screenshots, notes)          | `docs/shared/journal/` |
| AI chat panel                               | `docs/shared/chat-bot/` |
| **System & Architecture** | |
| Design tokens (colors, font, z-index)       | `docs/shared/design-tokens/` |
| Settings persistence / file backup          | `docs/shared/settings-persistence/` |
| All Zustand store slices (9 domain slices)  | `docs/shared/frontend/` → Zustand Store |
| All service API signatures                  | `docs/shared/frontend/` → Service Layer |
| Realtime adapter interface + hub events      | `docs/shared/frontend/` → realtimeService.ts / adapters/ |
| Shared components (Modal, TabButton, icons) | `docs/shared/frontend/` → Shared Components |
| Shared hooks (useClickOutside, etc.)        | `docs/shared/frontend/` → Shared Hooks |
| **Futures-Specific** | |
| Bot drawing tools (HLine, markers, API)     | `docs/futures/bot-trading/` |
| Copy trading / account copier               | `docs/futures/account-copier/` |
| Claude autonomous trader                    | `docs/futures/claude-trader/` |
| Algorithmic strategies (London Sniper, etc.)| `docs/futures/claude-strategies/` |
| Trading strategy research (Origin method)   | `docs/futures/trading-strategy/` |

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
│  │  │  Zustand Store (9 domain slices)                     │   │   │
│  │  │  connection | instrument | trading | drawings        │   │   │
│  │  │  layout | conditions | chartSettings | shortcuts     │   │   │
│  │  │  toast                                               │   │   │
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
| Frontend | React 19 + TypeScript + Vite |
| Chart | Lightweight Charts v5 (TradingView OSS) |
| State | Zustand (9 domain slices, persisted to localStorage + backend JSON file) |
| Styling | Tailwind CSS |
| Typography | System font stack: `-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif` |
| Backend proxy | Node.js + Express |
| Real-time | @microsoft/signalr (isolated in ProjectX adapter) |

---

## Design Tokens

See [`docs/shared/design-tokens/`](docs/shared/design-tokens/) — colors, font, z-index, shadows, radii, transitions.

---

## Bracket Strategy

The app uses a **dual-path** bracket strategy depending on the number of take-profit levels. **SL is always attached as a native bracket** on the entry order for zero-latency protection.

- **0-1 TPs**: Uses **gateway-native brackets** — SL and TP are attached atomically to the entry order (zero latency gap). Requires "Auto OCO Brackets" enabled on the account. Gateway handles OCO auto-cancel.
- **2+ TPs**: **SL is still native** (attached to entry order), but TPs are placed by the **client-side bracket engine** after fill (detected via SignalR). The engine discovers the gateway-created SL order to manage it (resize on TP fills, move on conditions). Conditions (e.g. "move SL to breakeven when TP 1 hits") are evaluated client-side.

See `docs/shared/bracket-engine/README.md` for the full runtime lifecycle.

---

## Quick Start

```bash
npm install          # installs root workspace deps
npm run dev          # starts both Vite (port 5173) and Express (port 3001)
```

Open `http://localhost:5173`, click the settings icon, enter your API key, and connect.
