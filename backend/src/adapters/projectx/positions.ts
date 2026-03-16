import axios from 'axios';
import type { ExchangePositions } from '../types';
import { getBaseUrl, authHeaders } from './auth';

interface GatewayResponse {
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

async function tryEndpoint(path: string, body: Record<string, unknown>): Promise<GatewayResponse> {
  const response = await axios.post(
    `${getBaseUrl()}${path}`,
    body,
    { headers: authHeaders() },
  );
  return response.data;
}

export const projectXPositions: ExchangePositions = {
  async searchOpen(accountId) {
    const n = Number(accountId);
    if (!Number.isFinite(n)) throw new Error(`Invalid numeric ID: "${accountId}"`);
    const body = { accountId: n };

    // Try known endpoint patterns in order
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
        // Continue to next endpoint on HTTP errors
      }
    }

    // All failed — return last result or empty
    return lastResult ?? { success: true, positions: [] };
  },
};
