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

---

## Trade Management (Long)

After the long trade is active, scan forward candle by candle watching for a **sign of weakness** (candle closing below a move to the high).

When a sign of weakness appears, check the **very next candle**:

1. **Immediate recovery** — next candle closes above the invalidation of weakness → dismiss the sign of weakness entirely, trade continues unchanged.

2. **No immediate recovery** — next candle does NOT close above the invalidation of weakness → keep scanning forward until a candle closes above the invalidation. When it does:
   - Find the **lowest point** between the sign of weakness candle and the recovery candle
   - Move the stop loss to the **midpoint of the lower wick** of that lowest candle
   - `new SL = low + (lower body edge - low) / 2` where lower body edge = `min(open, close)`

---

## Trade Management (Short)

After the short trade is active, scan forward candle by candle watching for a **sign of strength** (candle closing above a move to the low).

When a sign of strength appears, check the **very next candle**:

1. **Immediate recovery** — next candle closes below the invalidation of strength → dismiss the sign of strength entirely, trade continues unchanged.

2. **No immediate recovery** — next candle does NOT close below the invalidation of strength → keep scanning forward until a candle closes below the invalidation. When it does:
   - Find the **highest point** between the sign of strength candle and the recovery candle
   - Move the stop loss to the **midpoint of the upper wick** of that highest candle
   - `new SL = high - (high - upper body edge) / 2` where upper body edge = `max(open, close)`
