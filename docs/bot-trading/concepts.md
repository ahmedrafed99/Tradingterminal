# Concepts

Detection scripts: [`scripts/sos-technical-analysis.mjs`](../../scripts/sos-technical-analysis.mjs) — implements all concepts below as functions. Used via `node scripts/bot.mjs analyze --contractId <id> --date <YYYY-MM-DD>`.

## Anchor Points (provisional)

### The Low

The lowest price within the **7:30–9:20 AM ET** window. This candle is the starting point — from it we derive the move to the low and everything downstream.

### The High

The highest price within the **7:30–9:20 AM ET** window. This candle is the starting point — from it we derive the move to the high and everything downstream.

---

## SOS (Structure of Support)

### Move to the Low

The **high** of the candle that has the **lowest price** (the low candle itself).

### Swing to the Low

The **high** of the candle **immediately before** the low candle.

### Sign of Strength

When a candle **closes above** the move to the low (above the high of the low candle).

### Invalidation of Strength (level)

The **low** of the candle that confirmed the sign of strength.

### Invalidation of Strength (confirmed)

When a candle **closes below** the invalidation of strength level. The sign of strength is no longer valid.

### Previous Sign of Strength (target)

Locates the previous structure's sign of strength by finding its low. Starting from a given move to the low:

1. Scan backwards candle by candle, looking at each candle's low
2. **Skip** candles whose low is below the move to the low level
3. **Stop** at the first candle whose low is above the move to the low level
4. From that candle, scan backwards for the first **UP candle** (bullish, close > open)
5. Continue scanning backwards for another **UP candle** that is **higher** than the first
6. The **lowest point** between these two UP candles is the previous structure's low

Once found, apply the standard SOS definitions: its high = the previous move to the low, and the candle that closed above it = the previous sign of strength. That sign of strength level is the **target**.

### Important Previous Sign of Strength (target)

A stricter version of the previous sign of strength. The SOS confirmation must occur **within** the two UP candles (before the 1st UP candle). If the SOS is not found within that range, **widen**: keep the 1st UP candle fixed, scan backwards from the current 2nd UP candle for the next UP candle **higher than the current 2nd UP candle**. Recompute the lowest point between the new 2nd UP and the fixed 1st UP, then search for SOS again within that wider range. Repeat until found or no more UP candles exist.

Steps 1–4 are the same as Previous Sign of Strength. Then:

5. Scan backwards for a **2nd UP candle** higher than the 1st
6. Find the **lowest point** between 2nd UP and 1st UP
7. Scan forward from that lowest point for the SOS — **capped at 1st UP candle index**
8. If SOS found within range → done, that level is the target
9. If not → scan backwards from current 2nd UP for the next UP candle higher than the **current 2nd UP** (1st UP stays fixed). Go to step 6.

---

## SOW (Structure of Weakness)

### Move to the High

The **low** of the candle that has the **highest price** (the high candle itself).

### Swing to the High

The **low** of the candle **immediately before** the high candle.

### Sign of Weakness

When a candle **closes below** the move to the high (below the low of the high candle).

### Invalidation of Weakness (level)

The **high** of the candle that confirmed the sign of weakness.

### Invalidation of Weakness (confirmed)

When a candle **closes above** the invalidation of weakness level. The sign of weakness is no longer valid.

### Previous Sign of Weakness (target)

Locates the previous structure's sign of weakness by finding its high. Starting from a given move to the high:

1. Scan backwards candle by candle, looking at each candle's high
2. **Skip** candles whose high is above the move to the high level
3. **Stop** at the first candle whose high is below the move to the high level
4. From that candle, scan backwards for the first **DOWN candle** (bearish, close < open)
5. Continue scanning backwards for another **DOWN candle** that is **lower** than the first
6. The **highest point** between these two DOWN candles is the previous structure's high

Once found, apply the standard SOW definitions: its low = the previous move to the high, and the candle that closed below it = the previous sign of weakness. That sign of weakness level is the **target**.

### Important Previous Sign of Weakness (target)

A stricter version of the previous sign of weakness. The SOW confirmation must occur **within** the two DOWN candles (before the 1st DOWN candle). If the SOW is not found within that range, **widen**: keep the 1st DOWN candle fixed, scan backwards from the current 2nd DOWN candle for the next DOWN candle **lower than the current 2nd DOWN candle**. Recompute the highest point between the new 2nd DOWN and the fixed 1st DOWN, then search for SOW again within that wider range. Repeat until found or no more DOWN candles exist.
