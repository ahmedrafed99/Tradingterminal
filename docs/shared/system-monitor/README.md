# Feature: System Monitor

Real-time data-flow monitoring and session logging. Diagnoses whether price freezes or lag originate from the broker server (SignalR/ProjectX) or from the app itself.

**Status**: Planned

---

## Use Case

During live trading, price can freeze or lag. Without instrumentation it's impossible to know whether the cause is:
- ProjectX server stopped sending ticks
- Backend WS proxy dropped the connection
- Frontend adapter fell behind
- Chart rendering stalled (RAF lag / main thread block)

This feature instruments every hop in the data pipeline, logs state transitions (not every tick), and produces a per-session report with drill-down files.

---

## Entry Point: Latency Display (Top Bar)

The existing latency indicator in the top bar doubles as the monitor entry point. No new UI chrome needed.

```
Normal:     12ms  ●        ← green dot, clickable
Degraded:   94ms  ◐        ← yellow, draws attention passively
Frozen:    ---    ○  ⚠    ← red + warning icon, hard to miss
```

Clicking anywhere on the latency display opens the monitor panel as a **floating overlay anchored below it** — not a modal, does not block the chart. Dismiss by clicking outside or `Escape`.

The dot color reflects the **worst node state** across the entire pipeline at a glance. During clean trading it blends in. When something breaks it signals without interrupting.

---

## Architecture: 3 Layers

### Layer 1 — Metric Collector (invisible, always running)

Hooks into each node in the data pipeline and samples health every ~1s via `requestAnimationFrame`:

```
[ProjectX SignalR] → [Backend WS Proxy] → [Frontend Adapter] → [Chart RAF loop]
       ↓                    ↓                     ↓                    ↓
  lastTickAt           lastTickAt            lastTickAt           lastPaintAt
  tickRate/min         forwarded/min         received/min         framesRendered/min
                                             RAF lag ms
```

**State machine per node — 3 states:**

```
         rate drops >20% or RAF lag >100ms        no tick for >3s
NORMAL ──────────────────────────────────→ DEGRADED ──────────────→ FROZEN
  ↑                                            ↑                       │
  └────────────────────────────────────────────┴───────────────────────┘
                          rate recovers
```

Only state **transitions** are logged — not individual ticks. This keeps log volume minimal regardless of tick frequency.

**Thresholds (configurable):**

| Trigger | Threshold |
|---|---|
| NORMAL → DEGRADED | tick rate drops >20% OR RAF lag >100ms |
| DEGRADED → FROZEN | no tick for >3s |
| FROZEN → NORMAL | tick received after silence |

---

### Layer 2 — Log Writer (event-driven)

Creates a `logs/` folder (user-chosen via File System Access API, same pattern as video recording). Writes **4 file types per session**:

#### File hierarchy

```
logs/
├── index.log                        ← master index across all sessions
├── session_YYYY-MM-DD.log           ← core file (tiny, human-readable)
├── prices_YYYY-MM-DD.bin            ← every tick, binary compact
├── incidents_YYYY-MM-DD.log         ← anomalies only, human-readable
└── raf_YYYY-MM-DD.log               ← RAF lag samples
```

#### `index.log` — master index (always open first)

```
INDEX  TradingTerminal Monitor Logs

2026-04-18  session_2026-04-18.log   incidents=3  verdict=2 server / 1 app
2026-04-17  session_2026-04-17.log   incidents=0  clean
2026-04-16  session_2026-04-16.log   incidents=5  verdict=5 server
```

#### `session_YYYY-MM-DD.log` — core file

```
SESSION  2026-04-18  09:30:01 ET
SYMBOL   NQ  CONTRACT  NQM5

STREAM   prices_2026-04-18.bin      ticks=11,247  gaps=1
STREAM   raf_2026-04-18.log         samples=7,200  avg=14ms  worst=340ms
STREAM   incidents_2026-04-18.log   count=3

INCIDENTS
  09:47:12  LAG     2.2s  → see incidents_2026-04-18.log#L1
  10:15:33  FREEZE  8.3s  → see incidents_2026-04-18.log#L8
  11:02:07  LAG     4.1s  → see incidents_2026-04-18.log#L19

HEALTH
  uptime        98.3%
  server_gaps   1  (8.3s)
  app_lags      2  (6.1s)
  verdict       freeze @ 10:15 = ProjectX server, not your app

SESSION_END  11:30:00  duration=120min
```

#### `prices_YYYY-MM-DD.bin` — binary tick log

Each tick = **12 bytes**:

```
[timestamp: 4B uint32 unix seconds][bid: 3B fixed-point][ask: 3B fixed-point][flags: 2B]
```

`flags` encodes: gap marker, source node, anomaly bit.

~11,000 ticks × 12 bytes = **~130 KB per session**. Incidents file stores the exact byte offset into this file so you can jump straight to what price was doing during any event.

#### `incidents_YYYY-MM-DD.log` — anomalies only

```
#L1
INCIDENT  LAG  09:47:12.001 → 09:47:14.220
  node      Adapter
  trigger   tick_rate 94→61/min (threshold: -20%)
  worst     RAF lag 340ms @ 09:47:12.881
  recovery  tick_rate back to 91/min
  prices    prices_2026-04-18.bin@offset=4821

#L8
INCIDENT  FREEZE  10:15:33.441 → 10:15:41.780
  node      SignalR  (server-side)
  duration  8.339s
  last_tick 10:15:33.441
  resumed   10:15:41.780
  prices    prices_2026-04-18.bin@offset=7103
```

#### Log size estimates

| File | Size |
|---|---|
| `session_*.log` | ~2 KB |
| `prices_*.bin` | ~130 KB |
| `incidents_*.log` | ~1 KB (normal day) |
| `raf_*.log` | ~50 KB |
| **Total per session** | **~185 KB** |

30 sessions ≈ ~5.5 MB. 90 sessions ≈ ~17 MB.

#### Retention

Configurable: keep all / keep N days / keep under X MB. Deletes oldest sessions first. New session starts automatically on app load after midnight ET.

---

### Layer 3 — Monitor UI Panel

#### Live flow diagram

Animated particle flow showing data moving through each node. Particles slow or stop at the broken node during lag/freeze.

```
[ProjectX]──●──[Backend]──●──[Adapter]──●──[Chart]
     ▲           ▲            ▲            ▲
  last: 0.3s  last: 0.3s  last: 0.4s   last: 0.4s
  92 tck/m    92 tck/m    91 tck/m     88 frm/m
```

Node colors: ● green (normal) · ◐ yellow (degraded) · ○ red (frozen)

#### Health sidebar

Per-node stats updated every second:
- Last tick age
- Tick rate (current vs baseline)
- RAF lag (ms)
- Mini bar showing rate relative to baseline

#### Incident log (collapsible)

```
▶ 09:47:12  ⚠ LAG     2.2s  [Adapter → Chart]   ← collapsed
▶ 10:15:33  ✗ FREEZE  8.3s  [ProjectX]           ← collapsed
▼ 11:02:07  ⚠ LAG     4.1s  [Adapter]            ← expanded
    11:02:07  Adapter  NORMAL→DEGRADED  94→23/min
    11:02:11  Adapter  DEGRADED→NORMAL  23→91/min
```

#### Report view

Load any past session from `index.log`. Shows session summary, incident list with expand/collapse, links to raw log files.

---

## Diagnosis Guide

| What you observe | Backend fresh | RAF lag | Verdict |
|---|---|---|---|
| Price sticky/jumping | ✓ | High (300ms+) | Frontend main thread blocked |
| Price frozen | ✗ | N/A | ProjectX server issue |
| Price frozen | ✓ | Normal | Chart render bug |
| Price slow | ✓ | Moderate (100–200ms) | Adapter falling behind |

**RAF lag** is the single most useful real-time indicator. Normal = ~12ms. Problem = 100ms+.

---

## Implementation Notes

- **Frontend-only** — no backend DB writes, no new API endpoints
- **File System Access API** — same folder-picker pattern as video recording feature; handle persisted in IndexedDB
- **No per-tick writes** — log writer fires only on state transitions
- **RAF loop** — metric sampling runs inside `requestAnimationFrame` so it never blocks the main thread between frames
- **Ring buffer in memory** — last 2 hours of raw metric samples kept in a circular buffer; only incidents and session summary flushed to disk

---

## Files (planned)

### Modified
| File | Change |
|---|---|
| `frontend/src/components/topbar/LatencyDisplay.tsx` | Add health dot, color from worst node state, click handler to open monitor panel |

### New
| File | Purpose |
|---|---|
| `frontend/src/services/monitor/metricCollector.ts` | Hooks into each pipeline node, samples health, runs state machine |
| `frontend/src/services/monitor/logWriter.ts` | Writes session/incident/binary files via File System Access API |
| `frontend/src/services/monitor/types.ts` | Shared types: NodeState, Incident, SessionSummary |
| `frontend/src/components/monitor/MonitorPanel.tsx` | Top-level floating panel anchored to latency display (flow diagram + sidebar + incident log) |
| `frontend/src/components/monitor/FlowDiagram.tsx` | Animated particle flow across nodes |
| `frontend/src/components/monitor/HealthSidebar.tsx` | Per-node stats |
| `frontend/src/components/monitor/IncidentLog.tsx` | Collapsible incident list |
| `frontend/src/components/monitor/ReportView.tsx` | Past session report viewer |

---

## Verification

1. Open monitor panel during live session → flow diagram shows particles moving, all nodes green
2. Simulate lag: throttle network in DevTools → particles slow, Adapter node turns yellow, RAF lag rises
3. Simulate freeze: disable network → particles stop at SignalR node, node turns red, freeze detected within 3s
4. Re-enable network → node recovers green, incident logged in collapsible list
5. End session → `session_*.log` and `incidents_*.log` written to chosen folder
6. Open report view → past session loads from `index.log`, incidents expandable with price offset links
