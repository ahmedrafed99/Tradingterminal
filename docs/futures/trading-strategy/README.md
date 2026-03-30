# Price Action Reversal Strategy — Origin Method

## Concepts

### Failure Level (Level That Took You Down / Up)

- **For a low**: identify the swing low, trace back until you find a **bullish candle** (close > open). Its **candle close** is the failure level.
- **For a high**: identify the swing high, trace back until you find a **bearish candle** (close < open). Its **candle close** is the failure level.

### Origin

After a swing forms and price "gains" the failure level:

1. Find **2 consecutive closes** above (for low) / below (for high) the failure level
2. After those 2 closes, find the candle with the **lowest close** (for low) / **highest close** (for high) — the deepest pullback
3. This is only valid if price then closes back beyond the failure level again (confirmation)
4. **Origin = that pullback candle's close**

### Session-Based Structure

At **15 minutes before session open**, look back **4 hours**:

- **London**: 07:45 UTC (08:00 UTC open), DST-aware
- **New York**: 14:15 UTC (14:30 UTC / 9:30 AM ET open), DST-aware

In the 4-hour lookback window:
1. Mark the **lowest point** (absolute low)
2. Mark the **highest point before the low**
3. Find the **origin** of the low and the **origin** of the high-before-low
4. Find previous swings' origins for targets

### Reversal Trade

**Long trigger:**
1. Price drops **below** the origin of the current low
2. Price then **closes above** the origin
3. **Enter long** at the origin level
4. **SL** = new low + 1 point
5. **Targets** = origins of previous lows (40% / 20% / 20%, rest EOD)

**Short trigger:**
1. Price rises **above** the origin of the high-before-low
2. Price then **closes below** the origin
3. **Enter short** at the origin level
4. **SL** = new high - 1 point
5. **Targets** = origins of previous highs (40% / 20% / 20%, rest EOD)

### Risk Management

- Only take the trade if entry-to-TP1 is **4:1 R:R** minimum
- Trailing drawdown: $2,000
- Profit target: $3,000
- Best single trade must not exceed 50% of total profit at pass

## Backtest Results — Origin Strategy (18 years NQ, 2008-2026)

Session-based (London + NY), 1-minute bars, 4-hour lookback.

| Metric | Value |
|--------|-------|
| **Total trades** | 1,615 |
| **Trades/day** | 0.36 |
| **Win rate** | 65.4% |
| **Profit factor** | 2.27 |
| **Sessions** | London: 897t, NY: 718t |

### Challenge Simulation

| Contracts | Pass% | Blow% | Median Days | Max DD |
|-----------|-------|-------|-------------|--------|
| 5 MNQ | 0.2% | 0.7% | 28d | $2,377 |
| 8 MNQ | 3.1% | 1.5% | 20d | $3,621 |
| 10 MNQ | 3.6% | 2.1% | 18d | $4,743 |
| 15 MNQ | 8% | 3% | 19d | $7,108 |
| 20 MNQ | 11.5% | 4.9% | 18d | $9,474 |

No DD-safe configs (all > $2k). High edge (65% WR, 2.27 PF) but low frequency (0.36/day) limits pass rate at small contract sizes.

### Diagnostics (8,813 session checks)

| Bottleneck | Long | Short | Total |
|------------|------|-------|-------|
| No targets found | 2,010 | 4,079 | 6,089 |
| R:R fail (4:1) | 2,833 | 1,770 | 4,603 |
| No trigger | 1,994 | 1,428 | 3,422 |
| No origin formed | 1,234 | 679 | 1,913 |

## Files

- `backend/backtest_origin.js` — origin-based backtest implementation
- `skill.md` — strategy rules definition
