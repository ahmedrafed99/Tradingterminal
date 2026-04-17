/**
 * Shared order placement function with bracket handling.
 * Used by BuySellButtons, useQuickOrder, and the remote bot API.
 * Single source of truth for: build bracket params, place order,
 * arm engine, store pendingBracketInfo.
 */

import { useStore } from '../store/useStore';
import { orderService } from './orderService';
import { bracketEngine } from './bracketEngine';
import { OrderType, OrderSide } from '../types/enums';
import type { PlaceOrderParams } from './orderService';
import type { BracketConfig } from '../types/bracket';
import type { Contract } from './marketDataService';
import { buildNativeBracketParams, buildNativeSLOnly } from '../types/bracket';
import { pointsToPrice } from '../utils/instrument';
import { fitTpsToOrderSize } from '../components/chart/hooks/resolvePreviewConfig';

export interface PlaceWithBracketsRequest {
  accountId: string;
  contractId: string;
  contract: Contract;
  side: OrderSide;
  size: number;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  /** Bracket config — from preset+drafts, ad-hoc, or bot-supplied */
  bracketConfig?: BracketConfig | null;
}

export interface PlaceWithBracketsResult {
  orderId: string;
}

export async function placeOrderWithBrackets(
  req: PlaceWithBracketsRequest,
): Promise<PlaceWithBracketsResult> {
  const { accountId, contractId, contract, side, size, orderType, limitPrice, stopPrice, bracketConfig } = req;

  const sym = contract.name.replace(/[A-Z]\d+$/i, '');
  if (useStore.getState().isBlacklisted(sym)) {
    throw new Error(`${sym} is blacklisted — orders are disabled on this symbol.`);
  }

  const params: PlaceOrderParams = {
    accountId,
    contractId,
    contractName: contract.name,
    type: orderType,
    side,
    size,
  };

  if (limitPrice != null) params.limitPrice = limitPrice;
  if (stopPrice != null) params.stopPrice = stopPrice;

  // Bracket handling
  const bracketsActive = bracketConfig != null
    && (bracketConfig.stopLoss.points >= 1 || bracketConfig.takeProfits.length >= 1);
  const hasPriceTriggers = bracketConfig?.conditions.some((c) => c.trigger.kind === 'profitReached') ?? false;

  const nativeBrackets = bracketsActive && bracketConfig && !hasPriceTriggers
    ? buildNativeBracketParams(bracketConfig, side, contract)
    : null;

  const engineNeeded = (bracketsActive && !nativeBrackets) || hasPriceTriggers;

  if (nativeBrackets) {
    Object.assign(params, nativeBrackets);
  } else if (bracketsActive && bracketConfig) {
    const nativeSL = buildNativeSLOnly(bracketConfig, side, contract);
    if (nativeSL) Object.assign(params, nativeSL);

    bracketEngine.armForEntry({
      accountId,
      contractId,
      entrySide: side,
      entrySize: size,
      config: bracketConfig,
      contract,
      nativeSL: !!nativeSL,
    });
  } else if (hasPriceTriggers && bracketConfig) {
    bracketEngine.armForEntry({
      accountId,
      contractId,
      entrySide: side,
      entrySize: size,
      config: bracketConfig,
      contract,
    });
  }

  // Compute and store pendingBracketInfo so Suspended bracket legs get prices
  if (bracketsActive && bracketConfig && limitPrice != null) {
    const entryPrice = limitPrice ?? useStore.getState().lastPrice ?? 0;
    const toP = (points: number) => pointsToPrice(points, contract);
    const fittedTps = fitTpsToOrderSize(bracketConfig.takeProfits, size);

    useStore.getState().setPendingBracketInfo({
      entryPrice,
      slPrice: bracketConfig.stopLoss.points > 0
        ? (side === OrderSide.Buy ? entryPrice - toP(bracketConfig.stopLoss.points) : entryPrice + toP(bracketConfig.stopLoss.points))
        : null,
      tpPrices: fittedTps.map((tp) =>
        side === OrderSide.Buy ? entryPrice + toP(tp.points) : entryPrice - toP(tp.points),
      ),
      side,
      orderSize: size,
      tpSizes: fittedTps.map((tp) => tp.size),
    });
  }

  try {
    const { orderId } = await orderService.placeOrder(params);

    if (engineNeeded) {
      bracketEngine.confirmEntryOrderId(orderId);
    }

    if (bracketsActive || nativeBrackets) {
      useStore.getState().setPendingEntryOrderId(orderId);
    }

    // Activate preview lines for TP/SL display during drag so that
    // useOrderLines skips phantom bracket rendering (previewHideEntry guard).
    // Keep pendingBracketInfo alive — it's needed to restore bracket lines
    // after a page refresh (previewHideEntry isn't persisted, so useOrderLines
    // falls back to pendingBracketInfo on reload).
    if (bracketsActive && limitPrice != null) {
      useStore.setState({
        previewHideEntry: true,
        previewSide: side,
        limitPrice,
        orderType: 'limit',
      });
    }

    return { orderId };
  } catch (err) {
    if (engineNeeded) {
      bracketEngine.clearSession();
    }
    useStore.getState().setPendingBracketInfo(null);
    useStore.getState().setPendingEntryOrderId(null);
    throw err;
  }
}
