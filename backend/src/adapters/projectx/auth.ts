import axios from 'axios';
import type { ExchangeAuth, ConnectParams } from '../types';

const DEFAULT_BASE_URL = 'https://api.topstepx.com';

const store = {
  token: null as string | null,
  baseUrl: DEFAULT_BASE_URL,
  userId: null as number | null,
};

// ---------------------------------------------------------------------------
// Internal helpers (used by sibling adapter files)
// ---------------------------------------------------------------------------
export function getBaseUrl(): string {
  return store.baseUrl;
}

export function getRtcBaseUrl(): string {
  try {
    const url = new URL(store.baseUrl);
    url.hostname = url.hostname.replace(/^api\./, 'rtc.');
    return url.toString().replace(/\/$/, '');
  } catch {
    return store.baseUrl.replace('//api.', '//rtc.');
  }
}

export function getToken(): string | null {
  return store.token;
}

export function authHeaders() {
  return {
    Authorization: `Bearer ${store.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export function getUserId(): number | null {
  return store.userId;
}

export function getUserApiBaseUrl(): string {
  return getUserApiBaseUrlInternal();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserApiBaseUrlInternal(): string {
  try {
    const url = new URL(store.baseUrl);
    url.hostname = url.hostname.replace(/^api\./, 'userapi.');
    return url.toString().replace(/\/$/, '');
  } catch {
    return store.baseUrl.replace('//api.', '//userapi.');
  }
}

function extractUserIdFromJwt(token: string): number | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    console.log('[auth] JWT claims:', JSON.stringify(payload));
    const raw = payload['userId'] ?? payload['uid'] ?? payload['nameid'] ?? payload['sub']
      ?? payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') { const n = parseInt(raw, 10); return isNaN(n) ? null : n; }
    return null;
  } catch { return null; }
}

async function enableOcoOnAllAccounts(): Promise<void> {
  const accountsRes = await axios.post(
    `${store.baseUrl}/api/Account/search`,
    { onlyActiveAccounts: true },
    { headers: authHeaders() },
  );
  const accounts: { id: number }[] = accountsRes.data?.accounts ?? accountsRes.data ?? [];
  const userApiBase = getUserApiBaseUrlInternal();

  await Promise.all(
    accounts.map((acct) =>
      axios.post(
        `${userApiBase}/TradingAccount/setAutoOcoBrackets`,
        { tradingAccountId: acct.id, autoOcoBrackets: true },
        { headers: authHeaders() },
      ),
    ),
  );
  console.log(`[auth] OCO brackets enabled on ${accounts.length} account(s)`);
}

// ---------------------------------------------------------------------------
// ExchangeAuth implementation
// ---------------------------------------------------------------------------
export const projectXAuth: ExchangeAuth = {
  async connect({ credentials, baseUrl }: ConnectParams) {
    const username = credentials['username'];
    const apiKey = credentials['apiKey'];
    if (!username || !apiKey) {
      throw new Error('ProjectX requires "username" and "apiKey" credentials.');
    }

    store.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    store.token = null;

    const url = `${store.baseUrl}/api/Auth/loginKey`;
    console.log(`[auth] POST ${url}`);

    let response;
    try {
      response = await axios.post(
        url,
        { userName: username, apiKey },
        { headers: { 'Content-Type': 'application/json', Accept: 'text/plain' } },
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response) {
        console.error(`[auth] HTTP ${err.response.status}`);
        const data = err.response.data as { errorMessage?: string } | undefined;
        throw new Error(data?.errorMessage ?? `HTTP ${err.response.status} from gateway`);
      }
      throw err;
    }

    console.log(`[auth] response:`, { ...response.data, token: response.data.token ? '***' : null });

    if (!response.data.success) {
      throw new Error(response.data.errorMessage ?? `Login failed (errorCode ${response.data.errorCode})`);
    }

    store.token = response.data.token as string;
    store.userId = (response.data.userId as number | undefined) ?? extractUserIdFromJwt(store.token);
    console.log(`[auth] ✓ connected, userId=${store.userId}`);

    // Auto-enable OCO brackets on all accounts (fire-and-forget)
    enableOcoOnAllAccounts().catch((err) => {
      console.warn('[auth] setAutoOcoBrackets failed (non-fatal):', err?.message ?? err);
    });
  },

  disconnect() {
    store.token = null;
    store.userId = null;
  },

  isConnected() {
    return store.token !== null;
  },

  getStatus() {
    return {
      connected: store.token !== null,
      baseUrl: store.baseUrl,
    };
  },
};
