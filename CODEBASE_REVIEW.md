# Codebase Review — ProjectX Trading Terminal

**Date:** 2026-03-02
**Scope:** Full codebase audit — architecture, reliability, security, performance, code quality

---

## 1. Executive Summary

This is a serious, ambitious application: a localhost trading terminal with
real-time charting, bracket order management, drawing tools, and a secure
backend proxy — all wired to a live trading API. The architecture is
fundamentally sound, TypeScript usage is excellent, and the state management
is well-designed.

However, the codebase has reached an inflection point. A 3,354-line god
component, zero tests, silent failures in financial-critical paths, and no
retry logic represent compounding technical debt that will bite hard on the
next iteration.

### Scorecard

```
 Category            Score   Status
 ──────────────────── ─────── ──────────────────────────
 Type Safety          9 / 10  Excellent — strict TS, 2 `any` uses
 Architecture         7 / 10  Good bones, god component problem
 State Management     8 / 10  Well-partitioned Zustand slices
 Reliability          4 / 10  Silent failures, no retries
 Security             6 / 10  Good proxy design, token leaks
 Performance          5 / 10  Zero memoization, no code splitting
 Test Coverage        0 / 10  No tests exist
 Accessibility        2 / 10  No ARIA, no keyboard nav
 Design Consistency   6 / 10  Tokens defined but not enforced
 Documentation        8 / 10  Feature READMEs are excellent
```

---

## 2. Architecture Overview

### Current System Diagram

```
 Browser (localhost:5173)
 ┌─────────────────────────────────────────────────────────────────┐
 │                                                                 │
 │  ┌──────────────────────────────────────────────────────────┐   │
 │  │  React 18 + TypeScript + Vite                            │   │
 │  │                                                          │   │
 │  │  ┌─────────────────────────────────────────────────┐     │   │
 │  │  │  TopBar                                         │     │   │
 │  │  │  Account selector · Balance · UP&L · RP&L       │     │   │
 │  │  └─────────────────────────────────────────────────┘     │   │
 │  │                                                          │   │
 │  │  ┌──────────────────────┐  ┌────────────────────────┐   │   │
 │  │  │  CandlestickChart    │  │  OrderPanel            │   │   │
 │  │  │  *** 3,354 LINES *** │  │  Market/Limit + Bracket│   │   │
 │  │  │                      │  │  Buy/Sell + Preview     │   │   │
 │  │  │  - Chart rendering   │  └────────────────────────┘   │   │
 │  │  │  - Drawing tools     │                               │   │
 │  │  │  - Order management  │                               │   │
 │  │  │  - Mouse handlers    │                               │   │
 │  │  │  - Keyboard shortcuts│                               │   │
 │  │  │  - Preview overlay   │                               │   │
 │  │  │  - Drag-to-modify    │                               │   │
 │  │  │  - Quick orders      │                               │   │
 │  │  │  - Crosshair labels  │                               │   │
 │  │  │  - Trade zones       │                               │   │
 │  │  │  - Volume profile    │                               │   │
 │  │  │  - 20+ useEffects    │                               │   │
 │  │  └──────────────────────┘                               │   │
 │  │                                                          │   │
 │  │  ┌──────────────────────────────────────────────────┐   │   │
 │  │  │  BottomPanel — Orders tab + Trades tab           │   │   │
 │  │  └──────────────────────────────────────────────────┘   │   │
 │  │                                                          │   │
 │  │  ┌──────────────────────────────────────────────────┐   │   │
 │  │  │  Zustand Store (601 lines, 12 slices)            │   │   │
 │  │  │  auth│accounts│orders│positions│trades│UI│drawings│   │   │
 │  │  └──────────────────────────────────────────────────┘   │   │
 │  │                                                          │   │
 │  │  ┌──────────────────────────────────────────────────┐   │   │
 │  │  │  Service Layer                                    │   │   │
 │  │  │  api · auth · order · market · account · realtime │   │   │
 │  │  │  bracketEngine (469 lines, client-side SL/TP)     │   │   │
 │  │  └────────────────────┬─────────────────────────────┘   │   │
 │  └───────────────────────┼──────────────────────────────────┘   │
 └──────────────────────────┼──────────────────────────────────────┘
                            │ HTTP / WebSocket
 ┌──────────────────────────▼──────────────────────────────────────┐
 │  Express Proxy (localhost:3001)                                  │
 │                                                                  │
 │  - JWT held in memory (never exposed to browser... mostly)      │
 │  - /auth/token endpoint DOES expose JWT  ◄── SECURITY CONCERN   │
 │  - CORS: origin '*'                      ◄── SECURITY CONCERN   │
 │  - No input validation on any route      ◄── RELIABILITY CONCERN│
 │  - No retry logic                        ◄── RELIABILITY CONCERN│
 └──────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS / WSS
 ┌──────────────────────────▼──────────────────────────────────────┐
 │  ProjectX Gateway API (api.topstepx.com / rtc.topstepx.com)    │
 └─────────────────────────────────────────────────────────────────┘
```

---

## 3. The Good

### 3.1 — Type Safety (9/10)

Strict TypeScript throughout. Only 2 uses of `any` (both justified —
TradingView's lightweight-charts doesn't fully type internal data).
Discriminated union types for drawings. Well-defined API interfaces.

### 3.2 — State Management (8/10)

```
 Zustand Store — 12 Slices
 ┌────────────────────────────────────────────────────┐
 │                                                    │
 │  ┌──────────┐ ┌──────────┐ ┌────────────┐         │
 │  │   Auth   │ │ Accounts │ │ Instrument │         │
 │  │ connected│ │ list     │ │ contract   │         │
 │  │ baseUrl  │ │ activeId │ │ timeframe  │         │
 │  └──────────┘ └──────────┘ └────────────┘         │
 │                                                    │
 │  ┌──────────┐ ┌──────────┐ ┌────────────┐         │
 │  │  Orders  │ │Positions │ │   Trades   │         │
 │  │ upsert() │ │ upsert() │ │ session[]  │         │
 │  │ remove() │ │ clear()  │ │ realized   │         │
 │  └──────────┘ └──────────┘ └────────────┘         │
 │                                                    │
 │  ┌──────────┐ ┌──────────┐ ┌────────────┐         │
 │  │    UI    │ │ Drawings │ │ DualChart  │         │
 │  │ settings │ │ hlines[] │ │ enabled    │         │
 │  │ preview  │ │ ovals[]  │ │ sync       │         │
 │  └──────────┘ └──────────┘ └────────────┘         │
 │                                                    │
 │  Persisted: baseUrl, activeAccountId, settings     │
 │  NOT persisted: credentials, live orders, positions│
 │                                                    │
 └────────────────────────────────────────────────────┘
```

Strengths:
- `upsertOrder` / `upsertPosition` skip updates if data is identical
- Services don't import store (clean separation)
- Credentials never persisted to localStorage

### 3.3 — Backend Proxy Design

The Express proxy correctly isolates the API key. JWT injection for
WebSocket upgrades is well-designed. The browser never directly talks
to the Gateway API.

### 3.4 — Real-Time Handling

SignalR connection deduplication, automatic reconnect, subscription
re-establishment on reconnect, proper cleanup on disconnect. This is
tricky plumbing done mostly right.

### 3.5 — Documentation

Feature-folder READMEs with a quick lookup table is genuinely useful.
CLAUDE.md with design tokens is smart. Most projects this size have zero docs.

---

## 4. The Bad

### 4.1 — God Component: CandlestickChart.tsx (3,354 lines)

This is the single biggest problem in the codebase. One file handles
everything the chart does:

```
 CandlestickChart.tsx — 3,354 lines
 ┌─────────────────────────────────────────────────────────────┐
 │                                                             │
 │  Lines 1-200       Chart initialization & lifecycle         │
 │  Lines 200-340     Bar fetching, caching, real-time updates │
 │  Lines 340-860     Drawing tools (hline, oval, arrow, ruler)│
 │                    - Mouse down/move/up handlers            │
 │                    - Hit testing                            │
 │                    - Drag & resize state machines            │
 │  Lines 860-1160    Primitive attachment & management        │
 │  Lines 1160-1410   Crosshair, countdown, symbol overlay    │
 │  Lines 1410-1720   + Button / Quick order placement         │
 │  Lines 1720-1900   Preview overlay (ghost SL/TP lines)     │
 │  Lines 1900-2080   Drag-to-modify order prices             │
 │  Lines 2080-2300   Order/position lines on chart           │
 │  Lines 2300-2500   Overlay labels (P&L, size, cancel)      │
 │  Lines 2500-2700   Trade zone visualization                │
 │  Lines 2700-2900   Volume profile integration              │
 │  Lines 2900-3100   Keyboard shortcuts (Esc, Del, Ctrl+Z)   │
 │  Lines 3100-3354   Cleanup, render, ref forwarding         │
 │                                                             │
 │  20+ useEffect hooks                                        │
 │  20+ useRef variables                                       │
 │  100+ useStore selectors                                    │
 │                                                             │
 └─────────────────────────────────────────────────────────────┘
```

Problems this causes:
- Adding a feature risks breaking unrelated behavior
- Debugging requires searching 3,000+ lines
- No one else can onboard to this component
- Cannot test individual behaviors in isolation

### 4.2 — Zero Tests

```
 Test Coverage Map
 ┌──────────────────────────────────────────┐
 │                                          │
 │  bracketEngine.ts  (469 lines)    0%  ██ │  ◄── FINANCIAL LOGIC
 │  CandlestickChart  (3,354 lines)  0%  ██ │  ◄── ALL INTERACTIONS
 │  realtimeService   (296 lines)    0%  ██ │  ◄── REAL-TIME DATA
 │  orderService      (61 lines)     0%  ██ │  ◄── ORDER PLACEMENT
 │  useStore          (601 lines)    0%  ██ │  ◄── STATE LOGIC
 │  DrawingsPrimitive (597 lines)    0%  ██ │  ◄── HIT TESTING
 │                                          │
 │  Total test files:  0                    │
 │  Test framework:    none installed       │
 │  Test scripts:      none in package.json │
 │                                          │
 └──────────────────────────────────────────┘
```

This is a **financial application**. The bracket engine alone handles
SL/TP placement, condition evaluation, and size allocation. All untested.

### 4.3 — Silent Failures in Financial-Critical Paths

This is the scariest finding. The diagram below shows what happens
when things go wrong:

```
 HAPPY PATH                          FAILURE PATH (current behavior)
 ──────────                          ─────────────────────────────────

 User clicks Buy                     User clicks Buy
       │                                   │
       ▼                                   ▼
 bracketEngine.arm()                 bracketEngine.arm()
       │                                   │
       ▼                                   ▼
 orderService.placeOrder()           orderService.placeOrder()
       │                                   │
       ▼                                   ▼
 Entry fills (SignalR event)         Entry fills (SignalR event)
       │                                   │
       ▼                                   ▼
 bracketEngine places SL  ─── OK    bracketEngine places SL ─── FAILS
       │                                   │
       ▼                                   ▼
 bracketEngine places TPs ─── OK    console.error(err)    ◄── THAT'S IT
       │                                   │
       ▼                                   ▼
 Position protected                  POSITION IS UNPROTECTED
 User sees SL/TP lines              USER HAS NO IDEA
                                     NO TOAST, NO BANNER, NO WARNING
                                     JUST A LINE IN THE BROWSER CONSOLE
```

Same pattern for:
- Quick order from chart (+button) — failure is `console.error` only
- SL modification after TP fill — if modify fails, SL size drifts
- All bracket operations — `.catch(console.error)` everywhere

### 4.4 — No Retry Logic

```
 Current Error Handling
 ┌──────────────────────────────────────────────────────┐
 │                                                      │
 │   HTTP Request ────► Success ────► Continue           │
 │       │                                              │
 │       └──── Failure ────► throw Error ────► DONE     │
 │                                                      │
 │   No retry.                                          │
 │   No exponential backoff.                            │
 │   No timeout (Axios default = infinite).             │
 │   No circuit breaker.                                │
 │                                                      │
 │   One network hiccup during SL placement =           │
 │   unprotected position, silently.                    │
 │                                                      │
 └──────────────────────────────────────────────────────┘
```

### 4.5 — No Input Validation on Backend

```
 Frontend                 Backend Proxy              Gateway API
 ────────                 ─────────────              ───────────

 req.body ──────────────► req.body ──────────────► req.body
              (no validation)         (no validation)

 Order size: -5?          Passes through.            ???
 Price: 0?                Passes through.            ???
 accountId: NaN?          Passes through.            ???
 Bar range: 1 year?       Passes through.            Potential DoS
```

---

## 5. Security Findings

### 5.1 — Token Exposure Chain

```
 ┌──────────────────────────────────────────────────────────────┐
 │  INTENDED FLOW (secure)                                      │
 │                                                              │
 │  Browser ──POST /auth/connect──► Proxy ──► Gateway           │
 │                                    │                         │
 │                               JWT stored                     │
 │                               in memory                      │
 │                                    │                         │
 │  Browser ──any request──────► Proxy injects                  │
 │                               Authorization                  │
 │                               header                         │
 │                                                              │
 │  Browser NEVER sees JWT                ◄── DESIGN INTENT     │
 └──────────────────────────────────────────────────────────────┘

 ┌──────────────────────────────────────────────────────────────┐
 │  ACTUAL FLOW (leaky)                                         │
 │                                                              │
 │  Browser ──GET /auth/token──► Proxy returns JWT as JSON      │
 │                                                              │
 │  Browser ──SignalR connect──► ?access_token=<JWT>            │
 │                                  │                           │
 │                                  ├── Visible in browser      │
 │                                  │   dev tools Network tab   │
 │                                  ├── Logged by proxies       │
 │                                  └── Stored in browser       │
 │                                      history                 │
 │                                                              │
 │  CORS: origin: '*'  ◄── Any origin can call /auth/token      │
 └──────────────────────────────────────────────────────────────┘
```

### 5.2 — Security Fixes Needed

| # | Issue | Fix |
|---|-------|-----|
| 1 | `cors({ origin: '*' })` | Change to `origin: 'http://localhost:5173'` |
| 2 | `/auth/token` exposes JWT | Use `accessTokenFactory` in SignalR, proxy negotiate |
| 3 | Token in WebSocket URL query param | Move to header via `accessTokenFactory` |
| 4 | No request body validation | Add schema validation (zod or joi) |
| 5 | No rate limiting | Add per-route rate limits |

---

## 6. Performance Findings

```
 Optimization Audit
 ┌─────────────────────────────────────────────────────────────┐
 │                                                             │
 │  React.memo() usage:        1 component   (CandlestickChart)│
 │  useMemo() usage:           0 calls                         │
 │  useCallback() usage:       0 calls   (1 in useNYClock)     │
 │  Code splitting:            none                            │
 │  Lazy loading:              none (modals always rendered)   │
 │  List virtualization:       none (OrdersTab, TradesTab)     │
 │  Off-screen early exit:     none (drawings render always)   │
 │                                                             │
 │  Inline object creation in render:  ~15 locations           │
 │  Array .map()/.flat() in render:    ~8 locations            │
 │  useEffect hooks in one component:  20+                     │
 │                                                             │
 └─────────────────────────────────────────────────────────────┘
```

---

## 7. Design System Violations

The CLAUDE.md defines a strict design token table. The codebase
doesn't fully follow it:

```
 SPECIFIED                              FOUND IN CODE
 ─────────                              ──────────────

 Border: #2a2e39                        #3a3e4a (ChartToolbar, ColorPopover,
                                                  DrawingEditToolbar)
                                        rgba(255,255,255,0.15) (DrawingEditToolbar)
                                        rgba(255,255,255,0.2) (DrawingEditToolbar)

 Modal backdrop: bg-black/60            rgba(0,0,0,0.55) (SnapshotPreview)

 Disabled: opacity-50                   opacity-80 (ChartToolbar)
                                        opacity-0 → opacity-100 (multiple)

 Approved colors only                   #f2f2f2, #e6e6e6, #cccccc, #b3b3b3,
                                        #808080, #666666, #4d4d4d, #333333,
                                        #1a1a1a (ColorPopover grayscale palette)
                                        #000, #fff (CandlestickChart, CountdownPrimitive)
```

---

## 8. Accessibility Findings

```
 a11y Audit
 ┌─────────────────────────────────────────────────────────────┐
 │                                                             │
 │  ARIA labels on interactive elements:     NONE              │
 │  Semantic <button> for clickable items:   PARTIAL           │
 │  Keyboard navigation in dropdowns:        NONE              │
 │  Focus trapping in modals:                NONE              │
 │  aria-expanded on dropdown triggers:      NONE              │
 │  role="tab" on tab buttons:               NONE              │
 │  Color-only indicators (buy/sell):        YES (problem)     │
 │  Screen reader support:                   NONE              │
 │                                                             │
 │  Note: For a personal localhost trading tool this is low     │
 │  priority, but worth noting for completeness.               │
 │                                                             │
 └─────────────────────────────────────────────────────────────┘
```

---

## 9. Console Artifacts

20+ `console.error` / `console.warn` statements scattered across
production code. These should either be:
- Removed entirely, or
- Gated behind `if (import.meta.env.DEV)`, or
- Replaced with a proper notification system (toasts)

Key files: CandlestickChart.tsx (12 statements), OrderPanel.tsx (3),
bracketEngine.ts (5+), TradesTab.tsx (2), OrdersTab.tsx (1).

---

## 10. Bracket Engine — Detailed Risk Analysis

The bracket engine is the most critical financial component. Here's
how its state machine works and where it breaks:

```
 Bracket Engine State Machine
 ═══════════════════════════════

 Phase 1: ARMED
 ┌─────────────────────────────────────────┐
 │  arm(config, accountId, side)           │
 │                                         │
 │  State:                                 │
 │    armedConfig = { sl, tps, conditions }│
 │    confirmedOrderId = null              │
 │    session = null                       │
 │    bufferedFills = []                   │
 │                                         │
 │  Incoming fills → buffered (not yet     │
 │  confirmed which order is ours)         │
 └────────────────────┬────────────────────┘
                      │
                      │ confirmEntryOrderId(orderId)
                      ▼
 Phase 2: CONFIRMED
 ┌─────────────────────────────────────────┐
 │  confirmedOrderId = orderId             │
 │                                         │
 │  Check bufferedFills for our orderId    │
 │  If found → skip to Phase 3            │
 │  Otherwise → wait for SignalR event     │
 │                                         │
 │  ◄── RACE WINDOW: If fill arrives       │
 │      between placeOrder response and    │
 │      confirmEntryOrderId call, it gets  │
 │      buffered. Handled, but fragile.    │
 └────────────────────┬────────────────────┘
                      │
                      │ Order status === 2 (filled)
                      ▼
 Phase 3: SESSION
 ┌─────────────────────────────────────────┐
 │  session = {                            │
 │    accountId, side, entryPrice,         │
 │    entrySize, config, slOrderId,        │
 │    tpOrderIds[], conditionsFired        │
 │  }                                      │
 │                                         │
 │  1. Place SL order ◄── CAN FAIL SILENTLY│
 │  2. Place TP orders (split by size)     │
 │     ◄── SIZE ALLOCATION CAN LOSE CONTRACTS
 │  3. Monitor for TP fills                │
 │     ◄── On TP fill:                     │
 │        a. Reduce SL size (can fail)     │
 │        b. Evaluate conditions (no order)│
 │  4. Monitor for SL fill                 │
 │     ◄── On SL fill:                     │
 │        Cancel remaining TPs             │
 │        Clear session                    │
 └─────────────────────────────────────────┘

 FAILURE POINTS (all silent):

 ┌── SL placement fails ──► Position unprotected, user unaware
 │
 ├── TP size sum ≠ entry size ──► Contracts lost in allocation
 │
 ├── SL modify fails after TP fill ──► SL size ≠ position size
 │
 ├── Multiple conditions on same TP ──► Arbitrary execution order
 │
 └── SignalR disconnects during session ──► No fill events received
                                            Bracket engine frozen
```

---

## 11. Summary of All Findings

### Grouped by Severity

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  CRITICAL — Fix before trusting with real money                 │
 │  ─────────────────────────────────────────────────              │
 │  1. Silent bracket engine failures (SL/TP placement)           │
 │  2. No error feedback to user on order failures                │
 │  3. Zero test coverage on financial logic                      │
 │  4. TP size allocation can silently lose contracts              │
 │                                                                 │
 │  HIGH — Fix soon, compounds over time                           │
 │  ────────────────────────────────────────                       │
 │  5. CandlestickChart.tsx is 3,354 lines (god component)        │
 │  6. No retry logic on any HTTP request                         │
 │  7. No request timeouts (Axios default = infinite)             │
 │  8. CORS set to origin: '*'                                    │
 │  9. JWT exposed via /auth/token + query parameter              │
 │  10. No input validation on backend routes                     │
 │                                                                 │
 │  MEDIUM — Quality improvements                                  │
 │  ──────────────────────────────                                 │
 │  11. Design system violations (borders, colors, opacity)       │
 │  12. 20+ console.error/warn in production code                 │
 │  13. No shared UI components (Dropdown, FormInput, icons)      │
 │  14. Zero useMemo/useCallback usage                            │
 │  15. No code splitting or lazy loading                         │
 │                                                                 │
 │  LOW — Nice to have                                             │
 │  ──────────────────                                             │
 │  16. No path aliases in tsconfig                               │
 │  17. Accessibility gaps (ARIA, keyboard nav, focus trapping)   │
 │  18. No structured logging (backend)                           │
 │                                                                 │
 └─────────────────────────────────────────────────────────────────┘
```

---

---

# Fix Plan

## Phase Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                                                                        │
 │  Phase 1          Phase 2          Phase 3           Phase 4           │
 │  SAFETY NET       DECOMPOSE        HARDEN            POLISH            │
 │                                                                        │
 │  ┌──────────┐    ┌──────────┐    ┌──────────┐     ┌──────────┐       │
 │  │ Add tests│    │ Split god│    │ Retry    │     │ Design   │       │
 │  │ Add toast│    │ component│    │ logic    │     │ system   │       │
 │  │ Fix SL/TP│    │ Extract  │    │ Timeouts │     │ a11y     │       │
 │  │ failures │    │ shared UI│    │ Security │     │ Perf     │       │
 │  └──────────┘    └──────────┘    └──────────┘     └──────────┘       │
 │                                                                        │
 │  "Stop the        "Make it        "Make it          "Make it           │
 │   bleeding"        manageable"     resilient"         right"           │
 │                                                                        │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Safety Net (Stop the Bleeding)

**Goal:** Make failures visible. Add minimum viable test coverage.

### 1.1 — Notification System (Toast)

Add a lightweight toast/notification component for user-facing errors.

```
 BEFORE                               AFTER
 ──────                               ─────

 bracketEngine:                       bracketEngine:
   .catch(console.error)                .catch((err) => {
                                          console.error(err);
                                          toast.error('SL placement failed');
                                        })

 Quick order:                         Quick order:
   .catch(console.error)                .catch((err) => {
                                          toast.error('Order failed: ' + msg);
                                        })

 ┌──────────────────────────────────────────────────┐
 │                                                  │
 │  Chart Area                                      │
 │  ┌────────────────────────────────────────────┐  │
 │  │                                            │  │
 │  │           candlestick chart                │  │
 │  │                                            │  │
 │  └────────────────────────────────────────────┘  │
 │                                                  │
 │  ┌────────────────────────────────────────┐      │
 │  │  ⚠ SL placement failed — position     │      │
 │  │    unprotected. Retry?       [Retry]   │ ◄── NEW
 │  └────────────────────────────────────────┘      │
 │                                                  │
 └──────────────────────────────────────────────────┘
```

**Implementation:**
- Create `frontend/src/components/ui/Toast.tsx` — minimal toast component
- Create `frontend/src/services/notifications.ts` — `toast.error()`, `toast.warn()`, `toast.success()`
- Wire into bracket engine, order service, and chart quick-order
- Financial failures get `variant: 'critical'` with retry action

### 1.2 — Bracket Engine Error Recovery

```
 CURRENT                                FIX
 ───────                                ───

 place SL ──► fail ──► console.error    place SL ──► fail ──► retry (3x, backoff)
                       (silent)                               │
                                                              ├── still fails?
                                                              │   toast.critical()
                                                              │   mark session.slFailed = true
                                                              │
                                                              └── succeeds on retry?
                                                                  update session.slOrderId
```

**Implementation:**
- Add `retryWithBackoff(fn, maxRetries=3)` utility
- Wrap SL/TP placement and modification calls
- Add `slFailed` / `tpsFailed` flags to session state
- UI shows warning indicator when bracket is degraded

### 1.3 — Fix TP Size Allocation

```
 CURRENT (lossy)                       FIX (normalized)
 ───────────────                       ─────────────────

 Entry: 5 contracts                    Entry: 5 contracts
 TP config: [2, 3, 2]                  TP config: [2, 3, 2]
                                       Sum = 7, entry = 5
 TP1: 2  (allocated: 2)               Normalize: [2/7*5, 3/7*5, 2/7*5]
 TP2: 3  (allocated: 5) ◄── full      = [1.43, 2.14, 1.43]
 TP3: 2  (SKIPPED)      ◄── lost!     Round: [1, 2, 2] = 5 ✓
                                       (last TP gets remainder)
```

### 1.4 — Test Infrastructure + Critical Tests

**Install:** Vitest + React Testing Library

```
 frontend/
 └── src/
     └── __tests__/
         ├── bracketEngine.test.ts      ◄── Priority 1
         │   ├── fill detection
         │   ├── SL placement + failure recovery
         │   ├── TP size allocation (edge cases)
         │   ├── condition evaluation ordering
         │   └── session cleanup
         │
         ├── orderService.test.ts       ◄── Priority 2
         │   ├── place order
         │   ├── cancel order
         │   └── error handling
         │
         ├── realtimeService.test.ts    ◄── Priority 3
         │   ├── connection lifecycle
         │   ├── reconnection + resubscription
         │   └── event parsing
         │
         └── useStore.test.ts           ◄── Priority 4
             ├── upsertOrder dedup
             ├── upsertPosition dedup
             └── persistence partialize
```

---

## Phase 2 — Decompose (Make It Manageable)

**Goal:** Break the god component. Extract shared UI.

### 2.1 — Split CandlestickChart.tsx

```
 BEFORE (1 file, 3,354 lines)

 CandlestickChart.tsx
 ┌─────────────────────────────────────────────────────────────┐
 │  everything                                                 │
 └─────────────────────────────────────────────────────────────┘


 AFTER (7 focused modules)

 CandlestickChart.tsx  (~400 lines — orchestrator)
 ┌─────────────────────────────────────────────────────────────┐
 │  Chart lifecycle, composition, ref forwarding               │
 │  Delegates to focused hooks and sub-components              │
 └─────────────────────────────────────────────────────────────┘
        │
        ├── hooks/
        │   ├── useChartBars.ts         (~200 lines)
        │   │   Bar fetching, caching, real-time candle updates
        │   │
        │   ├── useChartDrawings.ts     (~500 lines)
        │   │   Drawing creation, drag, resize, hit testing,
        │   │   keyboard shortcuts (Del, Ctrl+Z, Esc)
        │   │
        │   ├── useChartTrading.ts      (~400 lines)
        │   │   + button, quick order, preview overlay,
        │   │   drag-to-modify, order/position lines
        │   │
        │   ├── useChartPrimitives.ts   (~200 lines)
        │   │   Primitive lifecycle, attachment, cleanup
        │   │
        │   └── useChartCrosshair.ts    (~150 lines)
        │       Crosshair label, OHLC tooltip, countdown
        │
        └── sub-components/
            ├── OverlayLabels.tsx        (~200 lines)
            │   P&L labels, cancel buttons, size indicators
            │
            └── TradeZoneOverlay.tsx     (~150 lines)
                FIFO trade zone visualization
```

**Extraction Strategy — no behavior changes:**
1. Extract hooks first (pure logic, no JSX) — easiest to test
2. Move state + effects into hooks, keep refs local
3. CandlestickChart becomes a thin shell that calls hooks and renders
4. Each hook gets its own test file

### 2.2 — Extract Shared UI Components

```
 Repeated Patterns → Shared Components
 ──────────────────────────────────────

 ┌─────────────────┐     ┌─────────────────────────────────┐
 │  4× click-outside│    │  <Dropdown>                      │
 │  useState+useRef │ ──►│    trigger, content, onClose     │
 │  useEffect       │    │    Handles click-outside,        │
 │  (TopBar,        │    │    keyboard nav, positioning     │
 │   ChartToolbar,  │    └─────────────────────────────────┘
 │   DrawingEdit,   │
 │   InstrumentSel) │
 └─────────────────┘

 ┌─────────────────┐     ┌─────────────────────────────────┐
 │  Copy-pasted     │    │  <FormInput>                     │
 │  input styles    │ ──►│    bg-[#111] border-[#2a2e39]    │
 │  across 6+ files │    │    Enforces design tokens        │
 └─────────────────┘     └─────────────────────────────────┘

 ┌─────────────────┐     ┌─────────────────────────────────┐
 │  SVG icons       │    │  components/icons/               │
 │  inlined in      │ ──►│    EyeIcon, SettingsIcon,        │
 │  multiple files  │    │    ChevronIcon, etc.             │
 └─────────────────┘     └─────────────────────────────────┘

 ┌─────────────────┐     ┌─────────────────────────────────┐
 │  formatTime()    │    │  utils/format.ts                 │
 │  defined twice   │ ──►│    formatTime, formatPrice,      │
 │  (TradesTab,     │    │    formatPnL                     │
 │   TopBar)        │    └─────────────────────────────────┘
 └─────────────────┘

 New file tree:

 frontend/src/
 ├── components/
 │   └── ui/
 │       ├── Dropdown.tsx
 │       ├── FormInput.tsx
 │       ├── Toast.tsx
 │       └── icons/
 │           ├── EyeIcon.tsx
 │           ├── SettingsIcon.tsx
 │           └── ChevronIcon.tsx
 └── utils/
     ├── format.ts
     └── retry.ts
```

---

## Phase 3 — Harden (Make It Resilient)

**Goal:** Network resilience, security fixes, input validation.

### 3.1 — Retry Logic with Exponential Backoff

```
 utils/retry.ts

 ┌──────────────────────────────────────────────────────────┐
 │                                                          │
 │  async function retryWithBackoff<T>(                     │
 │    fn: () => Promise<T>,                                 │
 │    maxRetries = 3,                                       │
 │    baseDelay = 500                                       │
 │  ): Promise<T>                                           │
 │                                                          │
 │  Attempt 1 ──► fail ──► wait 500ms                       │
 │  Attempt 2 ──► fail ──► wait 1000ms                      │
 │  Attempt 3 ──► fail ──► throw (all retries exhausted)    │
 │                                                          │
 │  Used in:                                                │
 │    bracketEngine — SL placement, TP placement, SL modify │
 │    orderService — placeOrder, modifyOrder                │
 │                                                          │
 └──────────────────────────────────────────────────────────┘
```

### 3.2 — Request Timeouts

```
 api.ts changes:

 const api = axios.create({
   baseURL: '',
   timeout: 30_000,          ◄── NEW: 30 second timeout
 });
```

### 3.3 — Security Fixes

```
 Fix 1: CORS
 ────────────
 // backend/src/index.ts
 - app.use(cors({ origin: '*' }));
 + app.use(cors({ origin: 'http://localhost:5173' }));


 Fix 2: SignalR Token Handling
 ──────────────────────────────
 // realtimeService.ts
 - .withUrl(`${RTC_HOST}/hubs/market?access_token=${token}`, {
 -   skipNegotiation: true,
 -   transport: HttpTransportType.WebSockets,
 - })
 + .withUrl(`/hubs/market`, {
 +   accessTokenFactory: () => token,
 + })

 This routes SignalR through the proxy, which injects the
 JWT server-side. Browser never sees the token.


 Fix 3: Remove /auth/token endpoint
 ────────────────────────────────────
 No longer needed once SignalR goes through the proxy.
 The proxy's negotiate handler + WS upgrade already inject JWT.
```

### 3.4 — Backend Input Validation

```
 Add zod schemas for each route:

 // routes/orderRoutes.ts
 const PlaceOrderSchema = z.object({
   accountId:  z.number().int().positive(),
   contractId: z.string().min(1),
   type:       z.enum(['Limit', 'Market', 'StopMarket', 'StopLimit']),
   side:       z.enum(['Buy', 'Sell']),
   size:       z.number().int().positive(),
   limitPrice: z.number().optional(),
   stopPrice:  z.number().optional(),
 });

 router.post('/place', async (req, res) => {
   const parsed = PlaceOrderSchema.safeParse(req.body);
   if (!parsed.success) {
     return res.status(400).json({
       success: false,
       errorMessage: parsed.error.message,
     });
   }
   // ... proceed with parsed.data
 });
```

---

## Phase 4 — Polish (Make It Right)

**Goal:** Design consistency, performance, developer experience.

### 4.1 — Fix Design System Violations

```
 Search & replace across codebase:

 #3a3e4a  →  #2a2e39      (border color)
 rgba(255,255,255,0.15)  →  border-[#2a2e39]
 rgba(255,255,255,0.2)   →  border-[#2a2e39]
 rgba(0,0,0,0.55)        →  bg-black/60
 opacity-80              →  (remove or use opacity-50)
```

### 4.2 — Performance Optimizations

```
 Priority optimizations:

 1. Lazy-load modals
    ────────────────
    const BracketSettingsModal = lazy(() => import('./BracketSettingsModal'));
    const SnapshotPreview = lazy(() => import('./SnapshotPreview'));

 2. Memoize expensive selectors
    ───────────────────────────
    const orders = useStore(useShallow((s) => s.orders));

 3. Virtualize lists
    ────────────────
    OrdersTab, TradesTab → use @tanstack/react-virtual
    Only render visible rows.

 4. Add path aliases
    ────────────────
    // tsconfig.json
    "paths": {
      "@/*": ["./src/*"]
    }

    // Before: import { useStore } from '../../../store/useStore';
    // After:  import { useStore } from '@/store/useStore';
```

### 4.3 — Console Cleanup

```
 Replace all console.error/warn in production code:

 Option A: Gate behind dev mode
   if (import.meta.env.DEV) console.error(...)

 Option B: Replace with toast (preferred for user-facing errors)
   toast.error('Failed to cancel order');

 Option C: Remove entirely (for non-actionable logs)
```

---

## Implementation Order

```
 Week 1                    Week 2                   Week 3
 ───────                   ──────                   ──────

 ┌─ Phase 1 ────────────┐  ┌─ Phase 2 ────────────┐  ┌─ Phase 3+4 ──────────┐
 │                       │  │                       │  │                       │
 │ Day 1-2:              │  │ Day 1-3:              │  │ Day 1-2:              │
 │  Toast component      │  │  Extract hooks from   │  │  Security fixes       │
 │  Wire into bracket    │  │  CandlestickChart     │  │  (CORS, SignalR,      │
 │  engine + order svc   │  │  (useChartBars,       │  │   input validation)   │
 │                       │  │   useChartDrawings,   │  │                       │
 │ Day 3:                │  │   useChartTrading)    │  │ Day 3:                │
 │  Fix TP allocation    │  │                       │  │  Retry logic +        │
 │  Add retry to SL/TP   │  │ Day 4:                │  │  timeouts             │
 │                       │  │  Extract shared UI    │  │                       │
 │ Day 4-5:              │  │  (Dropdown, FormInput,│  │ Day 4-5:              │
 │  Install Vitest       │  │   icons)              │  │  Design system fixes  │
 │  Write bracket engine │  │                       │  │  Console cleanup      │
 │  tests (8-10 cases)   │  │ Day 5:                │  │  Performance (lazy    │
 │  Write order service  │  │  Wire shared UI       │  │  load, memoization)   │
 │  tests                │  │  into existing code   │  │  Path aliases         │
 │                       │  │                       │  │                       │
 └───────────────────────┘  └───────────────────────┘  └───────────────────────┘

 Each phase is independently shippable.
 No phase requires the others to be complete.
 All changes are additive — nothing breaks between phases.
```

---

## File Impact Map

```
 Files that will be MODIFIED:
 ┌──────────────────────────────────────────────────────────────────────┐
 │  frontend/src/components/chart/CandlestickChart.tsx  (split apart)  │
 │  frontend/src/services/bracketEngine.ts              (error handling)│
 │  frontend/src/services/realtimeService.ts            (token fix)    │
 │  frontend/src/services/api.ts                        (timeout)      │
 │  frontend/src/components/chart/ChartToolbar.tsx       (design fixes)│
 │  frontend/src/components/chart/DrawingEditToolbar.tsx (design fixes)│
 │  frontend/src/components/chart/ColorPopover.tsx       (design fixes)│
 │  frontend/src/components/chart/SnapshotPreview.tsx    (design fixes)│
 │  backend/src/index.ts                                (CORS)        │
 │  backend/src/routes/orderRoutes.ts                   (validation)  │
 │  backend/src/routes/marketDataRoutes.ts              (validation)  │
 │  backend/src/routes/authRoutes.ts                    (remove token)│
 │  frontend/package.json                               (add vitest)  │
 │  frontend/tsconfig.json                              (path aliases)│
 └──────────────────────────────────────────────────────────────────────┘

 Files that will be CREATED:
 ┌──────────────────────────────────────────────────────────────────────┐
 │  frontend/src/components/ui/Toast.tsx                                │
 │  frontend/src/services/notifications.ts                             │
 │  frontend/src/utils/retry.ts                                        │
 │  frontend/src/utils/format.ts                                       │
 │  frontend/src/components/ui/Dropdown.tsx                            │
 │  frontend/src/components/ui/FormInput.tsx                           │
 │  frontend/src/components/chart/hooks/useChartBars.ts               │
 │  frontend/src/components/chart/hooks/useChartDrawings.ts           │
 │  frontend/src/components/chart/hooks/useChartTrading.ts            │
 │  frontend/src/components/chart/hooks/useChartPrimitives.ts         │
 │  frontend/src/components/chart/hooks/useChartCrosshair.ts          │
 │  frontend/src/components/chart/OverlayLabels.tsx                   │
 │  frontend/src/components/chart/TradeZoneOverlay.tsx                │
 │  frontend/src/__tests__/bracketEngine.test.ts                      │
 │  frontend/src/__tests__/orderService.test.ts                       │
 │  frontend/src/__tests__/realtimeService.test.ts                    │
 │  frontend/src/__tests__/useStore.test.ts                           │
 └──────────────────────────────────────────────────────────────────────┘

 Files that will be DELETED:
 ┌──────────────────────────────────────────────────────────────────────┐
 │  (none — all changes are additive or in-place modifications)        │
 └──────────────────────────────────────────────────────────────────────┘
```
