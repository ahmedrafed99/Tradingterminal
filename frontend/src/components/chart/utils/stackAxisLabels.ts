export interface StackItem {
  y: number;
}

/**
 * De-overlaps axis label positions in-place:
 * 1. Pushes labels outside the countdown-price zone.
 * 2. Sorts by Y and stacks any that are closer than labelHeight.
 * Returns the same array (mutated).
 */
export function stackAxisLabels<T extends StackItem>(
  items: T[],
  countdownY: number | null,
  labelHeight = 18,
  countdownZone = 25,
): T[] {
  if (countdownY !== null) {
    for (const item of items) {
      const dist = item.y - countdownY;
      if (Math.abs(dist) < countdownZone) {
        item.y = dist >= 0 ? countdownY + countdownZone : countdownY - countdownZone;
      }
    }
  }
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y < labelHeight) {
      items[i].y = items[i - 1].y + labelHeight;
    }
  }
  // Forward stacking pushes items downward, which can drag an above-zone label
  // 1px back into the badge. Re-clamp only above-zone items (below-zone items
  // are pushed further away by stacking, so they never need re-clamping).
  if (countdownY !== null) {
    for (const item of items) {
      const dist = item.y - countdownY;
      if (dist < 0 && Math.abs(dist) < countdownZone) {
        item.y = countdownY - countdownZone;
      }
    }
  }
  return items;
}
