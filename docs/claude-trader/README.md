# Claude Trader — NQ 50K Challenge

Autonomous NQ/MNQ trading system operated by Claude to pass TopStepX's 50K Trading Combine.

---

## Challenge Rules

| Parameter | Value |
|-----------|-------|
| Account size | $50,000 |
| Profit target | $3,000 (pass at $53,000) |
| Max drawdown | $2,000 (floor at $48,000) |
| Consistency rule | Best single trade P&L < 50% of target (**$1,500 max**) |
| Rebill cycle | 30 days |
| Instrument | MNQ (Micro E-mini Nasdaq-100), $2/point |

### Account IDs

| Account | ID | Purpose |
|---------|----|---------|
| Practice (150K) | `20130833` | Testing, strategy validation |
| Challenge (50K) | `20292418` | Live challenge attempt |

---

## Strategy (Default)

Trade using general technical analysis — support/resistance, trend structure, key levels. Be non-biased. Use limit orders at levels with brackets. The Price Action Strategy below is an advanced system to apply only when explicitly told to.

---

## Price Action Strategy (apply ONLY when told to)

### Core Concept

We don't care about up or down. We care about **move sequences** — price moves from level to level. These levels are the extremes of trends where reversals happen. We trace what price does and only trade confirmed moves.

**Gain** = 2 consecutive closes above a level.
**Lose** = 2 consecutive closes below a level.
One close and back doesn't count.

### Definitions

**Level that made the low:**
1. Start at the low candle
2. Scan backwards (left) for the **first UP candle** (close > open) before the low
3. Mark the **body** of that candle (open to close) — that's the level zone (has a top and bottom)

**Level that made the high:**
1. Start at the high candle
2. Scan backwards (left) for the **first DOWN candle** (close < open) before the high
3. Mark the **body** of that candle (open to close) — that's the level zone (has a top and bottom)

**Previous low** (relative to a given low):
1. Start from the low, find its "level that made the low" zone
2. Scan backwards through swing lows
3. Find the first swing low **L(n)** that is **higher** than the zone (it didn't break through)
4. **L(n+1)** — the next swing low after L(n) — is the **previous low** (the first low that broke under the zone)

**Previous high** (relative to a given high):
1. Start from the high, find its "level that made the high" zone
2. Scan backwards through swing highs
3. Find the first swing high **H(n)** that is **lower** than the zone (it didn't break through)
4. **H(n+1)** — the next swing high after H(n) — is the **previous high** (the first high that broke above the zone)

Each previous low/high also has its own "level that made it" — the structure is recursive.

**Timeframes to check:** 1-min, 3-min, 15-min, and 4-hour. These give the best reactions.

### Long Setups

**Long Scenario 1 — Reclaim the zone (small move):**
1. Price drops below the **bottom** of level that made the low (sweep)
2. Price **gains** (2 consecutive closes above) the bottom
3. LONG → target: **top** of level that made the low

**Long Scenario 2 — Full sequence (traced move):**
1. Price **gains top** of level that made the low → breakout confirmed
2. Price pushes up, **tests bottom** of level that made the previous low → target is in play
3. Price pulls back down, **holds bottom** of level that made the low → support confirmed (level flip)
4. LONG at the bottom of level that made the low
5. Target: **top** of level that made the previous low

The logic: price already traced the path — broke out, touched the next level, came back, held. We ride the second push with confirmed support and confirmed target.

### Short Setups

**Short Scenario 1 — Lose the zone (small move):**
1. Price pushes above the **top** of level that made the high (sweep)
2. Price **loses** (2 consecutive closes below) the top
3. SHORT → target: **bottom** of level that made the high

**Short Scenario 2 — Full sequence (traced move):**
1. Price **loses bottom** of level that made the high → breakdown confirmed
2. Price pushes down, **tests top** of level that made the previous high → target is in play
3. Price pulls back up, **holds top** of level that made the high → resistance confirmed (level flip)
4. SHORT at the top of level that made the high
5. Target: **bottom** of level that made the previous high

### Move Sequence (general flow)

**From the low going up:**
1. Price makes a low → find its "level that made the low"
2. If price **gains** the level → expect move to test the **level that made the previous low**
3. If price gains that too → continue up to the next level, and so on

**From the high going down:**
1. Price makes a high → find its "level that made the high"
2. If price **loses** the level → expect move to test the **level that made the previous high**
3. If price loses that too → continue down to the next level, and so on

Price moves from level to level. We never trade blind — we trace what price does and enter on confirmed retests targeting the next level in the sequence.

### Position Sizing

| Phase | Size | Max risk/trade | Max daily loss |
|-------|------|----------------|----------------|
| Start ($50,000-$50,500) | 1 MNQ | $30 (15pt SL) | $100 |
| Building ($50,500-$51,000) | 1-2 MNQ | $40 (15-20pt SL) | $150 |
| Midway ($51,000-$52,000) | 2-3 MNQ | $60 (15-20pt SL) | $200 |
| Final push ($52,000-$53,000) | 1-2 MNQ | $30 (conservative) | $100 |

**Risk rules:**
- Never risk more than 1% of current balance per trade ($500 absolute max)
- Scale DOWN when approaching drawdown floor ($48,500 balance = 1 MNQ max, 10pt SL)
- Scale DOWN in final push to protect gains
- No single trade P&L can exceed $1,500 (consistency rule)

### Trade Management

**Entry:**
- Use **LIMIT orders at the failure zone** — not market orders after confirmation
- Add 2-3pt buffer for better fill rate
- Bracket attached (SL + TP atomically)
- SL: beyond the sweep extreme (the wick past the failure zone)
- TP: opposite failure zone, or at minimum 1:2 R:R

**Invalidation (scratch immediately if ANY occur):**
- **Reclaim fails**: 2 consecutive 1-min closes back through the failure zone against your direction
- **New extreme**: Price makes a new high (if short) or new low (if long) after entry
- **Volume surge against**: A candle with 2x+ average volume closes against your direction

**Exit rules:**
- Invalidation triggered → flatten at market immediately
- TP hit (auto via bracket)
- SL hit (auto via bracket)
- Trail SL to breakeven if 50%+ to target
- Flatten everything by 3:50 PM ET

---

## Trading Schedule

| Time (ET) | Activity |
|-----------|----------|
| 9:15-9:30 AM | Pre-market: check overnight levels, identify support/resistance |
| 9:30-9:45 AM | Opening range formation — NO TRADES, just observe |
| 9:45-11:30 AM | **Primary window** — fade failed breakouts, VWAP bounces |
| 11:30 AM-1:30 PM | Lunch — NO TRADES (low volume chop) |
| 1:30-2:00 PM | Assess if afternoon setup developing |
| 2:00-3:30 PM | **Secondary window** — afternoon reversal only if strong signal |
| 3:30-4:00 PM | Close all positions, end of day |

---

## Tool Reference

All tools in `backend/claude-tools.sh`. Use `curl` commands directly (avoids permission issues with `source`).

### Account Management
```bash
curl -s "http://localhost:3001/accounts"                          # Check all balances
curl -s "http://localhost:3001/positions/open?accountId=ACCT_ID"  # Open positions
curl -s "http://localhost:3001/orders/open?accountId=ACCT_ID"     # Open orders
```

### Market Data
```bash
# Last N bars: unit 2=Minute, unitNumber=candle size
# 1 bar (latest price):
curl -s -X POST "http://localhost:3001/market/bars" -H "Content-Type: application/json" -d '{"contractId":"CON.F.US.MNQ.H26","live":false,"unit":2,"unitNumber":1,"startTime":"2026-03-16T00:00:00.000Z","endTime":"2026-03-16T23:59:00.000Z","limit":1,"includePartialBar":true}'
# Change limit for more bars, unitNumber for 5-min etc.
```

### Order Placement
```bash
# Market buy with bracket (15pt SL = -60 ticks, 40pt TP = 160 ticks)
curl -s -X POST "http://localhost:3001/orders/place" -H "Content-Type: application/json" -d '{"accountId":"ACCT_ID","contractId":"CON.F.US.MNQ.H26","type":2,"side":0,"size":1,"stopLossBracket":{"ticks":-60,"type":4},"takeProfitBracket":{"ticks":160,"type":1}}'

# Market sell with bracket
curl -s -X POST "http://localhost:3001/orders/place" -H "Content-Type: application/json" -d '{"accountId":"ACCT_ID","contractId":"CON.F.US.MNQ.H26","type":2,"side":1,"size":1,"stopLossBracket":{"ticks":60,"type":4},"takeProfitBracket":{"ticks":-160,"type":1}}'

# Limit buy at level with bracket (PREFERRED — enter at the level, not after confirmation)
curl -s -X POST "http://localhost:3001/orders/place" -H "Content-Type: application/json" -d '{"accountId":"ACCT_ID","contractId":"CON.F.US.MNQ.H26","type":1,"side":0,"size":1,"limitPrice":PRICE,"stopLossBracket":{"ticks":-60,"type":4},"takeProfitBracket":{"ticks":160,"type":1}}'

# Limit sell at level with bracket
curl -s -X POST "http://localhost:3001/orders/place" -H "Content-Type: application/json" -d '{"accountId":"ACCT_ID","contractId":"CON.F.US.MNQ.H26","type":1,"side":1,"size":1,"limitPrice":PRICE,"stopLossBracket":{"ticks":60,"type":4},"takeProfitBracket":{"ticks":-160,"type":1}}'

# Cancel order
curl -s -X POST "http://localhost:3001/orders/cancel" -H "Content-Type: application/json" -d '{"accountId":"ACCT_ID","orderId":"ORDER_ID"}'
```

### Bracket Tick Math
- 1 point = 4 ticks (0.25 tick size)
- LONG: SL ticks **negative**, TP ticks **positive**
- SHORT: SL ticks **positive**, TP ticks **negative**
- Examples: 10pts = 40 ticks, 15pts = 60 ticks, 20pts = 80 ticks, 25pts = 100 ticks

### Drawing on Chart (DISABLED)
Remote drawing polling (`useRemoteDrawings`) is currently disabled. The backend `/drawings/add` endpoint still exists but the frontend no longer polls `/drawings/pending`.
```bash
# Horizontal line with label (backend route exists but frontend polling is off)
curl -s -X POST "http://localhost:3001/drawings/add" -H "Content-Type: application/json" -d '{"type":"hline","price":PRICE,"color":"#COLOR","strokeWidth":1,"text":{"content":"LABEL","color":"#COLOR","fontSize":12,"bold":false,"italic":false,"hAlign":"left","vAlign":"bottom"},"contractId":"CON.F.US.MNQ.H26","startTime":0,"extendLeft":true}'
# Colors: red=#ef5350 green=#26a69a blue=#2962ff orange=#f0a830 muted=#787b86
```

### Account IDs
- Practice: `20130833`
- Challenge: `20292418`

---

## Autonomous Execution (MUST USE)

Claude MUST use this autonomous loop when trading. The user may not be at the PC — do not wait for permission or confirmation. Run commands individually (never chain with `&&`) so they auto-approve.

### Startup Procedure

When a new conversation starts and you are told to trade (or you read this doc and it's during trading hours):

1. **Read this README first** — `docs/claude-trader/README.md`
2. **Read state file** — `docs/claude-trader/state.json` (persists between cycles)
3. **Read journal** — `docs/claude-trader/journal.csv` for lessons from past trades
4. **Check the time** — run `date -u` and convert to ET (UTC-4 during DST Mar-Nov, UTC-5 otherwise)
5. **Check balance** — run `curl -s http://localhost:3001/accounts`
6. **Draw key levels** on the chart (support, resistance, OR high/low)
7. **Start the trading loop** via `/loop 1m` with a short cron prompt

### Trading Flow (event-driven, NOT cron-based)

Trading is driven by **background alerts**, not periodic polling. You act when notified, not on a timer.

```
SETUP PHASE (you do this once, then wait)
│
├─ 1. CHECK TIME
│   └─ Outside 9:45 AM - 3:30 PM ET? → don't place new trades (flatten at 3:50 PM)
│
├─ 2. RISK GATE
│   ├─ Balance < $48,500? → NO TRADING
│   ├─ Daily loss > $150? → STOP for the day
│   ├─ 3 consecutive losses? → PAUSE 30 min
│   └─ Best trade P&L > $1,200? → Reduce TP targets
│
├─ 3. ANALYZE STRUCTURE
│   ├─ Fetch 5-min bars for trend direction
│   ├─ Fetch 1-min bars for entry levels
│   ├─ Identify key levels (OR high/low, S/R flips, day high/low)
│   └─ Determine trade direction (WITH the trend)
│
├─ 4. PLACE LIMIT ORDER + DRAW LEVELS
│   ├─ Place limit order with bracket at the level (add 2-3pt buffer)
│   ├─ Clear old drawings, draw entry/SL/TP levels on chart
│   └─ Update state.json
│
├─ 5. START ALERTS (then do nothing)
│   ├─ alert_fill ACCT_ID          → watches for fill or position close
│   ├─ alert_price TP_LEVEL dir    → watches if price hits TP without filling you
│   └─ WAIT — do not poll, do not check price, just wait for notification
│
ALERT FIRES → ACT
│
├─ If "ORDER FILLED → POSITION_OPENED":
│   └─ Restart alert_fill to watch for SL/TP exit → WAIT again
│
├─ If "POSITION_CLOSED" / "SL_HIT" / "TP_HIT":
│   ├─ Log trade to journal CSV
│   ├─ Check risk gates (daily loss, consecutive losses)
│   └─ Go back to SETUP PHASE for next trade
│
├─ If price alert fires (TP hit without fill):
│   ├─ Cancel the stale limit order
│   └─ Go back to SETUP PHASE — the move happened without you
│
└─ If 3:50 PM ET:
    └─ Flatten any position, cancel any orders, stop for the day
```

**IMPORTANT: Do NOT manually poll positions or orders while alerts are running.**
The alerts detect changes automatically. Manually checking positions will NOT interfere
with the alert scripts (they use their own snapshots), but it's unnecessary.

### Alert System (background scripts, event-driven)

Instead of polling every minute via cron, use **background alert scripts** that run silently
and only notify you when something happens. No cron needed.

Two scripts in `backend/scripts/`:

#### 1. Order Fill Alert — `alert_fill [accountId]`
Watches open orders and positions. Exits and notifies when anything changes (fill, SL/TP hit, position close).

```bash
# Run in background — notifies when order fills or position closes
alert_fill 20130833
```

#### 2. Price Alert — `alert_price <target> <above|below>`
Watches price. Exits and notifies when price crosses the target level.

```bash
# Notify when price drops to/below 24660
alert_price 24660 below

# Notify when price rises to/above 24740
alert_price 24740 above
```

Both are in `claude-tools.sh` and call scripts in `backend/scripts/`.

### Alert Workflow (MUST USE instead of cron)

**When placing a limit order:**
1. Analyze structure, identify level, place limit order with bracket
2. Draw levels on chart (clear old drawings first)
3. Start **two background alerts**:
   - `alert_fill ACCT_ID` — detects when order fills or position closes
   - `alert_price TP_LEVEL <above|below>` — detects if price hits TP area without filling you
4. **Do nothing** — wait for an alert to fire
5. When alert fires:
   - **Order filled** → restart `alert_fill` to watch for SL/TP exit
   - **SL/TP hit** → log to journal, reassess, place new setup
   - **Price hit TP without filling you** → cancel the stale limit, find new setup

**Rules:**
- Never use cron for polling — alerts are event-driven
- Never manually poll positions/orders while alerts run
- Always run BOTH alerts (fill + price at TP) when a limit order is waiting
- When order fills, restart `alert_fill` to watch for exit
- Don't edit backend files while alerts are running (restart causes false positives)

### State File: `docs/claude-trader/state.json`

Persists between cycles and conversations. Create if missing.

```json
{
  "date": "2026-03-16",
  "account": "challenge",
  "openingRange": { "high": 24750, "low": 24650, "formed": true },
  "dailyPnL": 0,
  "tradeCount": 0,
  "consecutiveLosses": 0,
  "bestTradePnL": 0,
  "lastTradeTime": null,
  "paused": false,
  "pauseUntil": null,
  "notes": ""
}
```

Reset this file each new trading day (when `date` doesn't match today).

### Key Lessons (from 2026-03-16)

1. **Use LIMIT orders at the level** — don't market order after confirmation. Confirmation costs 10+ points of slippage and makes SL too tight.
2. **Trade WITH the trend** — don't buy support in a downtrend or sell resistance in an uptrend. Check 5-min structure first.
3. **Invalidation is mandatory** — if 2 consecutive 1-min closes go against the thesis, flatten immediately. Don't wait for SL.
4. **Be aware of time-of-day volume** — 1 PM ET (end of lunch) often has volume spikes that blow through levels.
5. **Don't over-fetch data** — 1 bar for price check, more bars only when analyzing structure for a setup.
6. **Journal every trade** — write to `journal.csv` (challenge) or `journal-practice.csv` immediately after each trade closes.
7. **Cancel unfilled limits when the move happens without you** — if price reaches your TP level but your limit never filled, the setup played out. Cancel the limit immediately and look for a new setup. Use a price alert at the TP level alongside the order fill alert — if the price alert fires first, cancel the order.
8. **Don't edit backend files while alerts are running** — backend restart causes brief disconnect that triggers false positives in the order fill alert.
9. **Clear and redraw chart levels on each new trade** — don't leave stale drawings. Use `/drawings/clear-chart` then draw fresh levels.

---

## Risk Management Guardrails

1. **Daily loss limit**: Stop trading if down $150+ in a day (75% of single-day safe loss)
2. **Consecutive losses**: After 3 consecutive losses, stop for 30 minutes minimum
3. **Drawdown proximity**: If balance drops below $48,500, reduce to 1 MNQ and 10pt SL max
4. **Consistency check**: Track running best-trade P&L — if approaching $1,200, reduce TP targets
5. **No revenge trading**: After a loss, next trade must meet ALL setup criteria (no forcing)
6. **No overnight holds**: Flatten everything before 4:00 PM ET

---

## Progress Tracking

Target: $50,000 → $53,000 ($3,000 profit)

| Date | Starting Balance | Ending Balance | Trades | W/L | Notes |
|------|-----------------|----------------|--------|-----|-------|
| — | — | — | — | — | — |

---

## Lessons from Previous Attempt

From blown account (20109518):
- **Wider stops needed** — got stopped out on noise multiple times
- **Wait 15min after open** — first 15min is chaotic, not tradeable
- **Fade first breakout** — opening range breakouts fail more often than they succeed
- **Don't overtrade** — 2-4 quality trades per day is enough
