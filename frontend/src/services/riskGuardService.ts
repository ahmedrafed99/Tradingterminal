import { useStore } from '../store/useStore';
import { realtimeService } from './realtimeService';
import { positionService } from './positionService';
import { bracketEngine } from './bracketEngine';
import { marketDataService } from './marketDataService';
import type { Contract } from './marketDataService';
import { calcPnl } from '../utils/instrument';
import { showToast } from '../utils/toast';
import { PositionType } from '../types/enums';
import type { GatewayQuote, RealtimePosition } from './realtimeService';

class RiskGuardService {
  private started = false;
  private triggeredSet = new Set<string>();
  private contractCache = new Map<string, Contract>();
  private pendingFetches = new Set<string>();

  private quoteHandler = (contractId: string, data: GatewayQuote) => {
    const price = data.lastPrice ?? data.bestBid ?? data.bestAsk;
    if (price == null) return;
    this.checkPositions(String(contractId), price);
  };

  private positionHandler = (pos: RealtimePosition) => {
    if (pos.size === 0) {
      this.triggeredSet.delete(`${pos.accountId}:${pos.contractId}`);
    }
  };

  private checkPositions(contractId: string, price: number) {
    const state = useStore.getState();
    if (!state.riskGuardEnabled) return;

    const threshold = state.riskGuardMaxLoss;
    const positions = state.positions.filter(
      (p) => String(p.contractId) === contractId && p.size > 0,
    );
    if (positions.length === 0) return;

    let contract = this.contractCache.get(contractId);
    if (!contract) {
      const known = [state.contract, state.secondContract, state.orderContract]
        .find((c) => c != null && String(c.id) === contractId);
      if (known) {
        contract = known;
        this.contractCache.set(contractId, known);
      } else {
        void this.fetchAndCache(contractId);
        return;
      }
    }

    for (const pos of positions) {
      const key = `${pos.accountId}:${pos.contractId}`;
      if (this.triggeredSet.has(key)) continue;

      const isLong = pos.type === PositionType.Long;
      const rawDiff = isLong
        ? price - pos.averagePrice
        : pos.averagePrice - price;
      const pnl = calcPnl(rawDiff, contract, pos.size);

      if (pnl < -threshold) {
        this.triggeredSet.add(key); // sync before await — prevents double-fire during the network round-trip
        void this.fireGuard(pos, pnl, threshold);
      }
    }
  }

  private async fireGuard(pos: RealtimePosition, pnl: number, threshold: number) {
    const key = `${pos.accountId}:${pos.contractId}`;
    try {
      await positionService.closePosition(String(pos.accountId), String(pos.contractId));
      bracketEngine.clearSession();
    } catch {
      this.triggeredSet.delete(key); // re-arm on failure so the guard retries
      return;
    }
    showToast(
      'error',
      'Risk guard — position flattened',
      `Loss -$${Math.abs(Math.round(pnl))} exceeded limit of -$${threshold}`,
      null,
    );
  }

  private async fetchAndCache(contractId: string) {
    if (this.pendingFetches.has(contractId)) return;
    this.pendingFetches.add(contractId);
    try {
      const results = await marketDataService.searchContracts(contractId);
      const c = results.find((r) => String(r.id) === contractId);
      if (c) this.contractCache.set(contractId, c);
    } catch { /* ignore — will retry on next tick */ } finally {
      this.pendingFetches.delete(contractId);
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    realtimeService.onQuote(this.quoteHandler);
    realtimeService.onPosition(this.positionHandler);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    realtimeService.offQuote(this.quoteHandler);
    realtimeService.offPosition(this.positionHandler);
    this.triggeredSet.clear();
  }
}

export const riskGuardService = new RiskGuardService();
