import axios from 'axios';
import type { ExchangePositions } from '../types';
import type { ProjectXHelpers } from './auth';
import { debugLog } from '../../utils/debugLog';

interface GatewayResponse {
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

export function createProjectXPositions(h: ProjectXHelpers): ExchangePositions {
  async function tryEndpoint(path: string, body: Record<string, unknown>): Promise<GatewayResponse> {
    const response = await axios.post(
      `${h.getBaseUrl()}${path}`,
      body,
      { headers: h.authHeaders() },
    );
    return response.data;
  }

  return {
    async searchOpen(accountId) {
      const n = Number(accountId);
      if (!Number.isFinite(n)) throw new Error(`Invalid numeric ID: "${accountId}"`);
      const body = { accountId: n };

      const endpoints = [
        '/api/Position/searchOpen',
        '/api/Position/search',
        '/api/Position/get',
      ];

      let lastResult: GatewayResponse | null = null;
      for (const endpoint of endpoints) {
        try {
          const data = await tryEndpoint(endpoint, body);
          if (data.success) {
            return data;
          }
          console.log(`[positions] ${endpoint} returned success=false (errorCode=${data.errorCode}, msg=${data.errorMessage})`);
          lastResult = data;
        } catch (err: unknown) {
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          console.log(`[positions] ${endpoint} failed (HTTP ${status ?? 'unknown'})`);
        }
      }

      return lastResult ?? { success: true, positions: [] };
    },

    async closeContract({ accountId, contractId }) {
      const n = Number(accountId);
      if (!Number.isFinite(n)) throw new Error(`Invalid numeric ID: "${accountId}"`);
      const path = '/api/Position/closeContract';
      debugLog.log('projectx:closeContract', { endpoint: `${h.getBaseUrl()}${path}`, accountId: n, contractId });
      const data = await tryEndpoint(path, { accountId: n, contractId });
      debugLog.log('projectx:closeContract:response', data);
      return data;
    },
  };
}
