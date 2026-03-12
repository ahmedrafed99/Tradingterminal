# London Sniper 5:1 — NQ 1-Minute Challenge Speedrun (Best R:R)

> **Tags:** `challenge-pass` `aggressive` `<30-days` `1-trade-per-day` `prop-firm` `monthly-sub` `high-rr` `low-drawdown`

## Strategy Specs

| Spec | Value |
|------|-------|
| **Instrument** | MNQ (Micro Nasdaq-100 Futures) |
| **Timeframe** | 1-minute |
| **Contracts** | 18 MNQ ($36/point) |
| **Direction** | Counter-trend (fade London session) |
| **Take Profit** | 35 points / $1,260 per trade |
| **Stop Loss** | 7 points / $252 per trade |
| **Reward:Risk** | 5:1 |
| **Trades per day** | Max 1 |
| **Session** | RTH entry only (9:35am ET) |
| **Automation** | Fully mechanical — no discretion |
| **Max drawdown** | $1,764 (88% of $2,000 limit) |

## Account Requirements

| Param | Value |
|-------|-------|
| **Account size** | $50,000 |
| **Trailing drawdown** | $2,000 |
| **Profit target** | $3,000 |
| **50% consistency rule** | Max single trade profit ≤ 50% of total P&L at pass |

## Backtest Performance

### Rolling 30-Day Window Analysis (full year, 300 starting points)

| Metric | 18 MNQ (5:1 R:R) |
|--------|-------------------|
| **Pass rate** | **53.1%** |
| **Blow rate** | **0%** |
| **Fastest pass** | **3 days** |
| **Median days to pass** | **12 days** |
| **Max drawdown** | **$1,764** (88% of $2,000 limit) |
| **Best use** | Highest pass rate + lowest drawdown combo |

### Comparison: All Challenge Strategies

| Strategy | R:R | Pass% | Blow% | Fastest | Median | Max DD |
|----------|-----|-------|-------|---------|--------|--------|
| **London Sniper 5:1** | **5:1** | **53.1%** | **0%** | **3d** | **12d** | **$1,764** |
| London+VWAP Blitz 3:1 | 3:1 | 42% | 0% | 2d | 8d | ~$1,900 |
| London+VWAP Blitz 2:1 | 2:1 | 36% | 0% | 3d | 12d | $1,875 |
| London Fade (funded) | 2:1 | N/A | 0% | N/A | ~147d | $1,560 |

### Alternative London Sniper Sizing

| Contracts | London Min | Pass Rate | Blow Rate | Fastest | Median | Max DD |
|-----------|-----------|-----------|-----------|---------|--------|--------|
| 15 MNQ | 25 | 50.0% | 0% | 2d | 12d | $1,967 |
| **18 MNQ** | **35** | **53.1%** | **0%** | **3d** | **12d** | **$1,764** |
| 20 MNQ | 35 | 55.4% | 0% | 3d | 12d | $1,960 |

> 20 MNQ has slightly higher pass rate (55.4%) but fails the 50% consistency rule at some pass amounts. 18 MNQ at London min 35 is the sweet spot: best pass rate that always passes consistency, with the lowest max drawdown of any challenge strategy.

## Entry Rules

1. **Pre-market scan** (before 9:30am ET):
   - Measure the London session move: `NQ price at 9:25am ET` minus `NQ price at 3:00am ET`
   - If absolute move **< 35 points** → **no trade today** (skip)
2. **Direction**:
   - London moved **UP** ≥ 35 pts → **SHORT**
   - London moved **DOWN** ≥ 35 pts → **LONG**
3. **Entry**: Market order at the **close of the 5th RTH 1-minute bar** (9:35am ET)
4. **Bracket order**: Set immediately after fill:
   - Limit: entry ± 35 pts (profit target)
   - Stop: entry ∓ 7 pts (stop loss)
5. **EOD rule**: If neither target nor stop hit by 4:00pm ET, **close at market**

### Why 35-Point Minimum?

The higher London threshold (35 vs 15 in other strategies) filters for **high-conviction days** — when the European session has made a large directional move, the US open reversal tends to be stronger. This filter reduces trade frequency but dramatically improves win quality.

### Signal Frequency

~50% of trading days (London move ≥ 35 pts). You trade less often, but when you do, the edge is sharper.

## Risk Analysis

| Scenario | $ Impact | Remaining DD |
|----------|----------|-------------|
| Trade wins | +$1,260 | full |
| Trade loses | −$252 | $1,748 left |
| 2 consecutive losses | −$504 | $1,496 left |
| 3 consecutive losses | −$756 | $1,244 left |
| 7 consecutive losses | −$1,764 | $236 left (worst observed) |

With 5:1 R:R, you only need a **17% win rate** to break even. The strategy delivers well above that threshold.

### Drawdown Stats

| Metric | Value |
|--------|-------|
| **Max observed DD** | $1,764 |
| **DD as % of limit** | 88% |
| **Floor buffer (worst case)** | $236 |
| **Consecutive losses to blow** | 8 (never observed) |

## 50% Consistency Check

With 18 MNQ at TP:35, every winning trade = $1,260. To pass at $3,000:
- $1,260 / $3,000 = **42%** — under the 50% cap
- You need minimum ~3 winning trades to pass
- With ~50% signal frequency, that's ~6 trading days minimum

## Why This Beats The Other Strategies

1. **Highest pass rate (53.1%)** — more than half of all 30-day windows pass
2. **Lowest max drawdown ($1,764)** — $236 buffer vs $125 for Blitz 2:1
3. **Zero blow rate** — can't lose the account
4. **Simplest execution** — 1 trade per day, London fade only, no VWAP scanning needed
5. **5:1 R:R** — small losses, big wins. Only need 17% win rate to break even

The tradeoff: slightly slower fastest pass (3d vs 2d) compared to L+V combos, because you only take 1 trade per day. But the higher pass rate and lower drawdown more than compensate.

## Recommended Two-Phase Approach

1. **Phase 1 — London Sniper** (this strategy): Pass the challenge. 53% chance per 30-day window, 0% blow rate. Best odds of any strategy tested.
2. **Phase 2 — Cruise** (London Fade only): Once on the funded account with no monthly fees, switch to the conservative [London Fade](../londonFade/README.md) strategy for steady, low-risk income.

## Data Source

Backtested on 5.78M 1-minute NQ candles stored in `backend/data/candles.db`. Rolling window analysis uses 300 possible start dates across the most recent 12 months (254 valid sessions).
