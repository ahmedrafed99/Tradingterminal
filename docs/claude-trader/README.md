# Claude Trader

Autonomous trading module — Claude executes trades via the Trading Terminal's backend API.

## IMPORTANT: Read This Every New Conversation

Claude — when you start a new session and the user asks you to trade or check trades:

1. **Read this entire file first** to recover full context
2. **Check memory files** at `C:\Users\Ahmed\.claude\projects\c--Users-Ahmed-Projects-TradingTerminal\memory\`
3. **Check open positions/orders** before doing anything: `GET /positions/open?accountId=20109518` and `GET /orders/open?accountId=20109518`
4. **Check account balance** to know current drawdown status: `GET /accounts`
5. **Update this file** after every trade action (entry, SL move, close, new trade). Keep the trade log and status section current.
6. **Act autonomously** — the user wants you to make trading decisions without asking. Move stops, trail profits, close positions, place trades — just do it and report.
7. **Cancel orphaned orders** — SL/TP orders are NOT OCO-linked. When one fills, cancel the other immediately.
8. **Native bracket orders DON'T WORK** on this account — always place entry first, then separate SL (Stop) and TP (Limit) orders.

## Account

| Field | Value |
|-------|-------|
| Account ID | `20109518` |
| Account Name | 50KTC-V2-93360-44037915 |
| Type | TopStepX Prop Firm Challenge (Practice/Sim) |
| Starting Balance | $50,000.00 |
| Rebill | Monthly (auto-reset) |

## Challenge Conditions

| Rule | Value |
|------|-------|
| **Max Drawdown** | $2,000 (from starting balance) |
| **Profit Target** | $3,000 (reach $53,000 to pass) |
| **Deadline** | End of current month |
| **Min Drawdown Floor** | $48,000 (balance cannot drop below this) |
| **Pass Threshold** | $53,000 |

## Current Status (2026-03-13)

| Metric | Value |
|--------|-------|
| Current Balance | $48,377.18 |
| P&L from Start | -$1,622.82 |
| Drawdown Used | $1,622.82 / $2,000 (81%) |
| Drawdown Remaining | **$377.18** |
| Needed to Pass | $4,622.82 |
| Days Left in Month | ~18 |

## Risk Management Rules

1. **Always use SL + TP** on every entry (no naked positions)
2. **Minimum R:R**: 2:1 always
3. **Max concurrent positions**: 1
4. **No trading during low-liquidity windows**: Avoid 5–6 PM ET daily close/open
5. **Stop trading for the day after 2 consecutive losses**
6. **Move to breakeven** once +25 pts in profit

## Position Sizing (Scale with Cushion)

Risk per trade = ~10-15% of drawdown cushion. R:R stays 2:1 minimum.

| Drawdown Cushion | Max Risk | Size | Instrument | SL | TP |
|-----------------|----------|------|------------|----|----|
| < $500 | $50 | 1 MNQ | MNQ ($0.50/tick) | 25 pts | 50 pts |
| $500–$1,000 | $100 | 1 MNQ (50pt SL) or 2 MNQ (25pt SL) | MNQ | 25–50 pts | 50–100 pts |
| $1,000–$2,000 | $150–200 | 2–3 MNQ | MNQ | 25–50 pts | 50–100 pts |
| > $2,000 (in profit) | $200–400 | 1–2 MES ($1.25/tick) or 4+ MNQ | MES or MNQ | 25–50 pts | 50–100 pts |
| > $3,000 (near target) | Conservative | Reduce size, protect gains | MNQ | Tight | Tight |

## Preferred Trading Windows (all times ET)

| Window | Time (ET) | Time (UTC) | Priority | Notes |
|--------|-----------|------------|----------|-------|
| **RTH Open** | 9:30–11:30 AM | 14:30–16:30 | Primary | Best volume, cleanest trends |
| **Econ Data** | 8:30 AM | 13:30 | Secondary | CPI/PPI/NFP days only |
| **London Open** | 3:00–4:00 AM | 8:00–9:00 | Secondary | Sets daily trend sometimes |

**Avoid:** 12–2 PM (lunch chop), 4–6 PM (close/reset), 8 PM–2 AM (low liquidity overnight)

## Available API Commands

### Authentication
```
POST /auth/connect        — Connect to gateway
POST /auth/disconnect     — Disconnect
GET  /auth/status         — Check connection
```

### Order Execution
```
POST  /orders/place       — Place order (Market/Limit/Stop/TrailingStop)
POST  /orders/cancel      — Cancel order
PATCH /orders/modify      — Modify order
GET   /orders/open        — List open orders
```

#### Place Order Payload
```json
{
  "accountId": 20109518,
  "contractId": "CON.F.US.MNQ.H26",
  "type": 2,              // 1=Limit, 2=Market, 4=Stop, 5=TrailingStop
  "side": 0,              // 0=Buy, 1=Sell
  "size": 1,
  "stopLossBracket": { "ticks": 120, "type": 2 },
  "takeProfitBracket": { "ticks": 240, "type": 2 }
}
```

### Positions & Accounts
```
GET /accounts             — List accounts (balance, canTrade)
GET /positions/open       — Open positions
```

### Market Data
```
POST /market/bars                   — OHLCV candle history
GET  /market/contracts/search       — Search contracts
GET  /market/contracts/available    — All contracts
```

### Trade History
```
GET /trades/search        — Filled trades with P&L
```

### Conditional Orders
```
POST   /conditions          — Create candle-close condition
PATCH  /conditions/:id      — Update
DELETE /conditions/:id      — Delete
GET    /conditions/events   — SSE stream (triggered/failed/expired)
```

## Instrument Reference

| Symbol | Contract ID | Tick Size | Tick Value | Notes |
|--------|------------|-----------|------------|-------|
| MNQ | CON.F.US.MNQ.H26 | 0.25 | $0.50 | Micro Nasdaq — primary |
| MES | CON.F.US.MES.H26 | 0.25 | $1.25 | Micro S&P |
| MYM | CON.F.US.MYM.H26 | 1.0 | $0.50 | Micro Dow |
| MGC | CON.F.US.MGC.J26 | 0.10 | $1.00 | Micro Gold |
| MNQ (full) | CON.F.US.ENQ.H26 | 0.25 | $5.00 | E-mini Nasdaq (10x MNQ) |

## Enums

```
OrderType:   1=Limit, 2=Market, 4=Stop, 5=TrailingStop
OrderSide:   0=Buy, 1=Sell
OrderStatus: 0=Open, 1=Closed, 2=Cancelled, 3=Error
```

## Trade Log

Track all trades placed by Claude here.

| # | Date | Instrument | Side | Size | Entry | SL | TP | Result | P&L |
|---|------|-----------|------|------|-------|----|----|--------|-----|
| 1 | 2026-03-12 23:34 UTC | MNQ (MNQH6) | SHORT | 1 | 24,583.00 | BE (24,583) | 24,533.00 (-50pt) | **WIN** | +$99.26 |
| 2 | 2026-03-13 00:00 UTC | MNQ (MNQH6) | SHORT | 1 | 24,517.50 | BE (24,517.50) | 24,467.50 (-50pt) | **BE** | -$1.24 |

**Trade #1 Notes:**
- Thesis: Strong bearish trend, NQ dropped 350+ pts on the session. Shorting into overnight fade.
- Risk: $50 (25 pts x $2/pt). Reward: $100 (50 pts). R:R = 2:1.
- SL Order ID: 2628681938 (Buy Stop @ 24608)
- TP Order ID: 2628682028 (Buy Limit @ 24533)
- **IMPORTANT:** These are NOT OCO-linked. If one fills, manually cancel the other.
- **UPDATE 23:47 UTC:** SL moved to breakeven (24,583) after price moved +38pts in our favor. Free trade now.

## Lessons Learned

Track what works and what doesn't so future sessions can improve.

1. **Native bracket orders fail** — gateway error "Brackets cannot be used with Position Brackets." Always place separate SL/TP orders after fill.
2. **Move to breakeven early** — once +25 pts in profit, move SL to entry. Protects the thin drawdown cushion.
3. **Overnight session is viable for trend continuation** — the bearish trend from RTH carried into the overnight on 2026-03-12.
4. **MNQ is the right instrument** for this account — $0.50/tick keeps risk controllable with $277 drawdown remaining.

## Maintenance Checklist

Do this at the START of every new conversation:

- [ ] Read this README fully
- [ ] Check memory files for user preferences and feedback
- [ ] Query positions, orders, balance via API
- [ ] Update the "Current Status" section with fresh numbers
- [ ] Update the trade log with any trades that closed since last session
- [ ] If drawdown cushion changes significantly, adjust risk management rules
