# Feature: System Monitor

Real-time data-flow monitoring, live event console, and session incident log. Diagnoses whether price freezes or lag originate from the broker server (SignalR) or from the app itself.

**Status**: Implemented

---

## Entry Point

Top bar "Monitor" button opens the panel as a full-height slide-up overlay. Click backdrop or press `Escape` to dismiss.

The top bar also shows a state dot (green / yellow / red) reflecting `worstState` across all nodes.

---

## Architecture: 3 Layers

### Layer 1 — Metric Collector (`metricCollector.ts`)

Singleton, always running once connected (started in `TopBar` on auth). Hooks into each pipeline hop and samples health via `requestAnimationFrame` (~1s cadence). Zero cost when monitor panel is closed.

**Pipeline instrumented:**

```
[Market Hub SignalR] → [Adapter] → [Chart RAF loop]
[User Hub SignalR]
```

**State machine per node — 3 states:**

```
         rate drops / lag spike                no tick > 3s
NORMAL ──────────────────────→ DEGRADED ──────────────────→ FROZEN
  ↑                                ↑                            │
  └────────────────────────────────┴────────────────────────────┘
                         tick recovers
```

Only state **transitions** are logged as incidents — not individual ticks.

**Tick pulse emission** (`onTickPulse` / `offTickPulse`): on every real SignalR quote, emits the `lastPrice` to subscribers, throttled to max 1/350ms. Used by `FlowDiagram` for the throw animation. Zero-cost when no subscribers.

**Public API:**

```ts
metricCollector.getSnapshot()          // NodeMetrics[], incidents, worstState, apiCategories
metricCollector.subscribe(cb)          // useSyncExternalStore-compatible, fires ~1/s
metricCollector.onTickPulse(cb)        // real-tick price stream, throttled
metricCollector.offTickPulse(cb)
metricCollector.pushApiCall(...)       // called by authService / orderService / marketDataService
metricCollector.start()                // called once on connect
```

---

### Layer 2 — Monitor UI Panel (`MonitorPanel.tsx`)

Slide-up overlay. Contains:

1. **Sticky header** — session duration, market open/closed badge, Console toggle, Reports button, close
2. **Market-closed notice** — suppresses alarm when outside market hours
3. **FlowDiagram** — live data-flow visualization (see below)
4. **ConsolePanel** (toggled) — live event stream per hub tab
5. **IncidentLog** — state transition history for the session
6. **Diagnosis hint** — plain-English explanation when `worstState !== 'normal'`
7. **ReportView** (modal) — past session report viewer

#### Flow Diagram (`FlowDiagram.tsx`)

Hub cards fan out into subscription lanes. Each lane has:
- Label + rate (events/s)
- Animated `ParticleTrack` canvas (ambient dots + thrown price text)
- Destination card or label

**Layout:**

```
[Market Hub card] ─┬─ quotes ─── [Adapter] ──●── [Chart]
                   ├─ depth ──── [Book]
                   └─ trades ─── [FRVP]

[User Hub card]  ──┬─ orders ─── [Orders]
                   ├─ positions ─ [Positions]
                   └─ trades ──── [Fills]
```

Hub cards are clickable — opens the Console panel on that hub's tab.

**Tick throw animation:**

On every throttled quote pulse from `metricCollector.onTickPulse`, the price (e.g. `24,305.25`) is "thrown" along the Quotes lane connector, then chains to the Adapter→Chart connector:

- **X position**: ease-out quadratic (`t*(2-t)`) — fast launch, smooth deceleration
- **Y position**: parabolic arc (`-sin(t*π)*7px`) — single upward arc, no oscillation
- **Rotation**: `0.25*(1-t)²` — initial kick tilt, decays to flat on arrival
- **Fade**: in over first 7% of travel, out over last 14%
- **Duration**: ~45 frames at 60fps ≈ 0.75s flight per segment
- Seg1 (`quotes` lane) arrival at 85% progress triggers seg2 (`Adapter→Chart`) burst

Node color (green / yellow / red) is shared between ambient dots and the thrown text.

#### Console Panel (`ConsolePanel.tsx`)

Three tabs: `market-hub`, `user-hub`, `api`. Each streams live events from `consoleBuffer`. Quotes and depth are throttled to prevent flooding. Clear button per tab.

#### Incident Log (`IncidentLog.tsx`)

Collapsible list of state transitions captured during the session. Each incident shows: node, transition (NORMAL→DEGRADED), duration, time.

#### REST API Table (`ApiSection` inside `FlowDiagram.tsx`)

Grouped by category (Auth, Orders, Market Data…). Expandable to endpoint level. Shows call count, last latency, avg latency, last called ago, ok/err status.

---

### Layer 3 — Report View (`ReportView.tsx`)

Accessible via the Reports button in the header. Shows session summary and per-incident drill-down.

---

## Implementation Notes

- **Frontend-only** — no backend DB writes, no new API endpoints
- **Snapshot cadence** — `metricCollector` fires subscriber callbacks ~1/s via RAF; `useSyncExternalStore` in `MonitorPanel` triggers re-renders at that cadence
- **Tick animation is zero-cost when panel closed** — `FlowDiagram` only registers `onTickPulse` while mounted; `metricCollector` only emits when `pulseListeners.size > 0`
- **No file logging** — the binary tick log / File System Access API described in early planning was not implemented; incidents are in-memory only

---

## Files

| File | Purpose |
|---|---|
| `frontend/src/services/monitor/metricCollector.ts` | Pipeline health sampler, state machine, incident recorder, tick pulse emitter |
| `frontend/src/services/monitor/consoleBuffer.ts` | Ring buffer (max 200) of live events per hub tab |
| `frontend/src/services/monitor/types.ts` | `NodeMetrics`, `NodeState`, `Incident`, `ConsoleEntry`, `ConsoleTab` |
| `frontend/src/components/monitor/MonitorPanel.tsx` | Top-level overlay panel |
| `frontend/src/components/monitor/FlowDiagram.tsx` | Hub cards, sublanes, particle tracks, throw animation, REST API table |
| `frontend/src/components/monitor/ConsolePanel.tsx` | Tabbed live event log |
| `frontend/src/components/monitor/IncidentLog.tsx` | Collapsible session incident history |
| `frontend/src/components/monitor/ReportView.tsx` | Past session report viewer |
