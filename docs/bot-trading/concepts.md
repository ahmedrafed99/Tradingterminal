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

### Re-validation of Strength

If the sign of strength has been invalidated, but a later candle **closes above** the move to the low again, the sign of strength is **re-confirmed**. The invalidation level updates to the low of the new confirmation candle. This cycle can repeat — the latest state (valid or invalidated) is what matters.

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

Structure-based algorithm. Starting from the escape candle:

**Step 2a — Find the previous SOS with confirmed SOW:**
1. Scan backwards from escape candle
2. For each candle, check if its high was **gained** (a later candle closed above it, before the move to low)
3. If gained: find the **highest point** in the range from that candle to the move to low
4. That highest candle's low = move to high. Check if any candle **closed below** it (SOW) before the move to low
5. If SOW confirmed → this is a valid previous SOS. Stop.

**Step 2b — Find the previous trend's low:**
1. Scan backwards from escape candle for the candle whose low is **closest to the move to low from above** (low >= move to low), AND older than the previous SOS from 2a
2. Find the **lowest point** between that candle and the previous SOS confirmation candle (inclusive)
3. That lowest point = previous trend's low candle. Its high = previous trend's move to low.

**Step 2c — Target:**
Apply SOS on the previous trend's move to low — find the first candle closing above it. Must occur before the previous SOS from 2a. That level is the **target**.

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

### Re-validation of Weakness

If the sign of weakness has been invalidated, but a later candle **closes below** the move to the high again, the sign of weakness is **re-confirmed**. The invalidation level updates to the high of the new confirmation candle. This cycle can repeat — the latest state (valid or invalidated) is what matters.

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

Structure-based algorithm (mirror of SOS). Starting from the escape candle:

**Step 2a — Find the previous SOW with confirmed SOS:**
1. Scan backwards from escape candle
2. For each candle, check if its low was **gained** (a later candle closed below it, before the move to high)
3. If gained: find the **lowest point** in the range from that candle to the move to high
4. That lowest candle's high = move to low. Check if any candle **closed above** it (SOS) before the move to high
5. If SOS confirmed → this is a valid previous SOW. Stop.

**Step 2b — Find the previous trend's high:**
1. Scan backwards from escape candle for the candle whose high is **closest to the move to high from below** (high <= move to high), AND older than the previous SOW from 2a
2. Find the **highest point** between that candle and the previous SOW confirmation candle (inclusive)
3. That highest point = previous trend's high candle. Its low = previous trend's move to high.

**Step 2c — Target:**
Apply SOW on the previous trend's move to high — find the first candle closing below it. Must occur before the previous SOW from 2a. That level is the **target**.
