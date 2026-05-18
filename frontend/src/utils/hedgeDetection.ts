import type { RealtimePosition } from '../adapters/types';
import type { Account } from '../services/accountService';
import { OrderSide, PositionType } from '../types/enums';

function getContractCode(contractId: string): string {
  return contractId.split('.')[3] ?? '';
}

/**
 * Sibling check using both contractId code AND the order's display-name base symbol.
 *
 * ProjectX contractId codes don't always match display names (e.g. NQ → "ENQ" internally).
 * Using orderBaseSymbol (from contract.name) as the reliable side covers this:
 *
 *   Order=NQ  (base="NQ",  code="ENQ"), pos=MNQ (code="MNQ"):
 *     posCode starts with M, suffix "NQ" === orderBase "NQ" ✓
 *
 *   Order=MNQ (base="MNQ", code="MNQ"), pos=NQ (code="ENQ"):
 *     orderBase starts with M, suffix "NQ", "ENQ".endsWith("NQ") ✓
 */
function areSiblings(posContractId: string, orderContractId: string, orderBaseSymbol: string): boolean {
  const posCode = getContractCode(posContractId);
  const orderCode = getContractCode(orderContractId);
  if (!posCode || !orderCode) return false;

  // Direct code M-prefix (works when codes match display names, e.g. MES/ES)
  if (posCode === 'M' + orderCode || orderCode === 'M' + posCode) return true;

  // Position is micro, order is standard — use display name as reliable side
  if (posCode.startsWith('M') && !orderCode.startsWith('M')) {
    const suffix = posCode.slice(1); // "NQ" from "MNQ"
    if (suffix.length >= 2 && orderBaseSymbol === suffix) return true;
  }

  // Order is micro, position is standard with possible exchange prefix (e.g. "ENQ")
  if (orderBaseSymbol.startsWith('M') && !posCode.startsWith('M')) {
    const suffix = orderBaseSymbol.slice(1); // "NQ" from "MNQ"
    if (suffix.length >= 2 && posCode.endsWith(suffix)) return true;
  }

  return false;
}

export interface HedgeConflict {
  accountName: string;
  symbol: string;
  direction: 'Long' | 'Short';
}

export function detectHedge(
  positions: RealtimePosition[],
  orderContractId: string,
  orderBaseSymbol: string,
  orderSide: OrderSide,
  orderSize: number,
  activeAccountId: string | null,
  accounts: Account[],
): HedgeConflict | null {
  const conflictingType = orderSide === OrderSide.Buy ? PositionType.Short : PositionType.Long;

  // If this order closes/reduces an existing position on the same account+contract,
  // no short is ever created — skip the entire hedge check.
  const isClosingOwn = positions.some(
    (p) => p.contractId === orderContractId
      && p.accountId === activeAccountId
      && p.type === conflictingType
      && p.size >= orderSize,
  );
  if (isClosingOwn) return null;

  for (const pos of positions) {
    if (pos.size <= 0) continue;
    if (pos.type !== conflictingType) continue;

    const isSameContract = pos.contractId === orderContractId;
    const isSibling = !isSameContract && areSiblings(pos.contractId, orderContractId, orderBaseSymbol);

    if (!isSameContract && !isSibling) continue;

    const account = accounts.find((a) => a.id === pos.accountId);
    return {
      accountName: account?.name ?? pos.accountId,
      symbol: getContractCode(pos.contractId) || pos.contractId,
      direction: pos.type === PositionType.Long ? 'Long' : 'Short',
    };
  }

  return null;
}
