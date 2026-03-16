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

## Strategy: Mean-Reversion Scalps at Key Levels

### Why Mean Reversion

NQ mean-reverts ~60-70% of the time during RTH, especially in the first 90 minutes. Breakouts that fail (the majority) provide high-probability fade entries. This strategy avoids chasing momentum — instead it waits for price to overextend, then fades back to value.

### Core Thesis

1. **Identify the range** — Use the first 15 minutes of RTH (9:30-9:45 AM ET) to establish the opening range high/low
2. **Fade failed breakouts** — When price breaks above/below the range and reverses, enter in the reversal direction
3. **Target the midpoint** — Take profit at the range midpoint or VWAP area
4. **Tight risk** — Stop loss beyond the breakout extreme (typically 10-15 MNQ points)

### Setup Criteria (all must be met)

1. **Time window**: 9:45 AM - 11:30 AM ET (after opening range forms, before lunch chop)
2. **Opening range defined**: At least 15min of RTH price action to establish high/low
3. **Failed breakout signal**: Price breaks range extreme by 5+ points, then reverses back inside on the same or next 1-min candle
4. **Entry trigger**: Enter on the reversal candle close back inside the range
5. **Volume confirmation**: Breakout candle should have above-average volume (sign of stop runs)

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
- Market order with bracket (SL + TP attached atomically)
- SL: 10-20 points beyond breakout extreme
- TP: Range midpoint or 1:2 R:R minimum

**Invalidation (scratch the trade immediately if ANY occur):**
- **Reclaim**: 2 consecutive 1-min closes back above/below the level you faded (e.g. shorted at resistance, 2 closes back above it = buyers are in control, get out)
- **Higher high / lower low**: Price makes a new high (if short) or new low (if long) after entry — momentum is against you, don't wait for SL
- **Volume surge against**: A candle with 2x+ average volume closes against your direction — institutional flow is opposing the trade

**During trade (if not invalidated):**
- If price moves 50% to target, trail SL to breakeven
- If trade stalls for 5+ minutes with no progress, consider scratch (exit at breakeven)

**Exit rules:**
- Invalidation triggered → flatten at market immediately (don't wait for SL)
- TP hit (auto via bracket)
- SL hit (auto via bracket)
- Time stop: Close any open trade by 11:30 AM ET (lunch = noise)
- Emergency: Flatten immediately if approaching daily loss limit

### Secondary Setups

When the opening range fade isn't available:

1. **VWAP bounce** — Price pulls back to VWAP area during trend day, bounces with confirmation candle. Enter with 10pt SL, target previous high/low.

2. **Double bottom/top on 5-min** — Two rejections at same level within 30 min. Enter on second bounce with SL 5pts below the double bottom/above double top.

3. **Afternoon reversal (2:00-3:00 PM ET)** — If market has trended strongly all morning, look for exhaustion reversal after 2 PM. Smaller size (1 MNQ), wider SL (20pt).

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

### Drawing on Chart
```bash
# Horizontal line with label (appears on chart via frontend polling)
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

### Trading Loop (every 1 minute via cron)

The cron prompt should be **short** — just tell Claude to run the trading cycle. All the logic is in this README.

**Cron setup:**
```
/loop 1m Run trading cycle per docs/claude-trader/README.md
```

**Each cycle:**

```
CYCLE START
│
├─ 1. CHECK EVENTS (synced to candle close)
│   ├─ watch_check ACCT_ID  (waits for :01/:31, compares state, prints events)
│   ├─ If EVENT: POSITION_OPENED → take snapshot, switch to monitoring mode
│   ├─ If EVENT: SL_HIT / TP_HIT / POSITION_CLOSED → log to journal, reassess
│   └─ If NO_CHANGE → continue to scan/manage
│
├─ 2. CHECK TIME
│   └─ Outside 9:45 AM - 3:30 PM ET? → skip (but flatten at 3:50 PM if holding)
│
├─ 3. RISK GATE (check BEFORE any trade)
│   ├─ Balance < $48,500? → NO TRADING, flatten if holding
│   ├─ Daily loss > $150? → STOP TRADING for the day
│   ├─ 3 consecutive losses? → PAUSE 30 min
│   └─ Best trade P&L > $1,200? → Reduce TP targets
│
├─ 4. IF HOLDING A POSITION → MANAGE IT
│   ├─ Fetch last 2 1-min bars for invalidation check
│   ├─ 2 consecutive closes against thesis? → FLATTEN immediately
│   ├─ Trail SL to breakeven if 50%+ to target
│   ├─ Time stop: flatten if held > 15 min with no progress
│   └─ Flatten everything by 3:50 PM ET
│
├─ 5. IF FLAT → SCAN FOR SETUP
│   ├─ Fetch last 1 bar (current price) — only fetch more bars when analyzing structure
│   ├─ 9:30-9:45 AM? → Just record opening range high/low, no trades
│   ├─ Identify key levels (OR high/low, day high/low, S/R flips)
│   ├─ **PREFER LIMIT ORDERS AT THE LEVEL** — don't market order after confirmation
│   ├─ Place limit order with bracket at identified level
│   ├─ Take snapshot: watch_snapshot ACCT_ID
│   └─ If no setup → do nothing, wait for next cycle
│
├─ 6. UPDATE STATE FILE
│   └─ Write state.json with: opening range, trade count, daily P&L, last action time
│
CYCLE END
```

### Trade Watcher (file-based, in claude-tools.sh)

The watcher compares position/order snapshots to detect fills, SL/TP hits, and position closes without modifying the backend. It syncs to :01 and :31 of each minute (1s after candle close and mid-candle).

```bash
# Save current state snapshot
watch_snapshot ACCT_ID

# Check for changes since last snapshot (syncs to :01/:31)
watch_check ACCT_ID
# Outputs: EVENT: POSITION_OPENED LONG size=1 price=24700
#          EVENT: POSITION_CLOSED SHORT price=24650
#          EVENT: SL_HIT price=24715
#          EVENT: TP_HIT price=24660
#          EVENT: ORDER_FILLED id=123 limit=24700
#          NO_CHANGE
```

**Workflow:**
1. Place limit order → `watch_snapshot` to record state
2. Cron fires → `watch_check` detects fill → switch to position management
3. Position closes (SL/TP) → `watch_check` detects → log to journal, scan for next setup

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
