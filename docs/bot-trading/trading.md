# Trading

See [concepts.md](concepts.md) for term definitions.

---

## Long Setup

**Condition:** Sign of strength confirmed (candle closes above the move to the low).

**Entry:** Limit buy at either:
- The **move to the low** (high of the low candle) — retest of the level
- The **invalidation of strength level** (low of the confirmation candle) — deeper entry

**Stop loss:** Midpoint of the **lower wick** of the candle that made the low.
- `SL = low + (lower body edge - low) / 2`
- Where lower body edge = `min(open, close)` of the low candle

**Target:** The **previous sign of strength** level (see [concepts.md](concepts.md) → Previous Sign of Strength).

---

## Short Setup

**Condition:** Sign of weakness confirmed (candle closes below the move to the high).

**Entry:** Limit sell at either:
- The **move to the high** (low of the high candle) — retest of the level
- The **invalidation of weakness level** (high of the confirmation candle) — deeper entry

**Stop loss:** Midpoint of the **upper wick** of the candle that made the high.
- `SL = high - (high - upper body edge) / 2`
- Where upper body edge = `max(open, close)` of the high candle

**Target:** The **previous sign of weakness** level (see [concepts.md](concepts.md) → Previous Sign of Weakness).
