/**
 * Tracks manual close actions (Close button, chart X button)
 * so the sound handler can distinguish manual exits from entries.
 *
 * Uses contractId instead of orderId because the SignalR fill event
 * can arrive before the REST placeOrder response (race condition).
 * Mark BEFORE placing the order, consume when the fill arrives.
 */

const pending = new Set<string>();

/** Mark a contract as having a pending manual close. Call BEFORE placeOrder. */
export function markAsManualClose(contractId: string): void {
  pending.add(String(contractId));
}

/** Check and consume a manual close marker. Returns true if it was a manual close. */
export function consumeManualClose(contractId: string): boolean {
  return pending.delete(String(contractId));
}
