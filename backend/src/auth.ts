import axios from 'axios';

// Default gateway — TopstepX
const DEFAULT_BASE_URL = 'https://api.topstepx.com';

// ---------------------------------------------------------------------------
// In-memory store — never leaves this process
// ---------------------------------------------------------------------------
const store = {
  token: null as string | null,
  baseUrl: DEFAULT_BASE_URL,
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------
export function getBaseUrl(): string {
  return store.baseUrl;
}

/** Derive RTC (SignalR) base URL from API base URL: api.x.com → rtc.x.com */
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

export function isConnected(): boolean {
  return store.token !== null;
}

export function authHeaders() {
  return {
    Authorization: `Bearer ${store.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Connect
// baseUrl defaults to https://api.topstepx.com
// ---------------------------------------------------------------------------
export async function connect(
  username: string,
  apiKey: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<void> {
  store.baseUrl = baseUrl.replace(/\/$/, '');
  store.token = null;

  const url = `${store.baseUrl}/api/Auth/loginKey`;
  console.log(`[auth] POST ${url} | userName: ${username}`);

  let response;
  try {
    response = await axios.post(
      url,
      { userName: username, apiKey },
      { headers: { 'Content-Type': 'application/json', Accept: 'text/plain' } },
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      console.error(`[auth] HTTP ${err.response.status}`, err.response.data);
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
  console.log(`[auth] ✓ connected as ${username}`);
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------
export function disconnect(): void {
  store.token = null;
}
