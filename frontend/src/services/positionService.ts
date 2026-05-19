import api from './api';
import type { RealtimePosition } from '../adapters/types';

interface GatewayResponse {
  success: boolean;
  errorMessage?: string;
  positions?: RealtimePosition[];
  [key: string]: unknown;
}

export const positionService = {
  async searchOpenPositions(accountId: string): Promise<RealtimePosition[]> {
    const res = await api.get<GatewayResponse>(`/positions/open?accountId=${accountId}`);
    // Don't throw on success=false — the endpoint may not exist on all gateways.
    // Just return empty so the app gracefully degrades to SignalR-only.
    if (!res.data.success) return [];
    // Try common response keys
    const raw: RealtimePosition[] = res.data.positions
      ?? (res.data as any).data
      ?? [];
    return raw
      .filter((p) => p && p.size > 0)
      .map((p) => ({ ...p, id: String(p.id), accountId: String(p.accountId) }));
  },

  async closePosition(accountId: string, contractId: string): Promise<void> {
    const res = await api.post<GatewayResponse>('/positions/close', { accountId, contractId });
    if (!res.data.success) {
      throw new Error(res.data.errorMessage || 'Failed to close position');
    }
  },

  async closeMany(targets: { accountId: string; contractId: string }[]): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0;
    await Promise.all(
      targets.map((t) =>
        this.closePosition(t.accountId, t.contractId).then(() => { ok++; }).catch(() => { failed++; }),
      ),
    );
    return { ok, failed };
  },
};
