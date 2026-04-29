type BracketPriceInfo = { slPrice: number | null; tpPrices: number[] };

/** Returns true if `price` matches any SL or TP price in `bi` (tick-rounded comparison). */
export function isBracketLegPrice(
  price: number,
  tickSize: number,
  bi: BracketPriceInfo,
): boolean {
  const r = Math.round(price / tickSize);
  return (bi.slPrice != null && Math.round(bi.slPrice / tickSize) === r) ||
    bi.tpPrices.some((tp) => Math.round(tp / tickSize) === r);
}
