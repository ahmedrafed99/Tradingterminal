# Feature: Multi-Account Connections

Allow multiple ProjectX/TopstepX API keys to be connected **simultaneously**. All active connections are live at the same time — no profile switching required. API calls route to the correct connection by account ID. SignalR uses one connection from any active account.

**Status**: Planned

---

## Problem: Module-Level Singleton

`backend/src/adapters/projectx/auth.ts` holds a single `const store = { token, baseUrl, userId }` at module scope. Every `createProjectXAdapter()` call returns references to the **same** store, so connecting a second account overwrites the first token.

The same applies to sub-modules (`accounts.ts`, `orders.ts`, etc.) — they import `getBaseUrl`, `authHeaders`, etc. directly from the module, binding them to the global store.

---

## Architecture Changes

### 1. Per-Instance Auth (`adapters/projectx/auth.ts`)

Convert from module-level singleton to a factory:

```ts
// BEFORE: module-level store (shared across all instances)
const store = { token: null, baseUrl: DEFAULT_BASE_URL, userId: null };
export function getToken() { return store.token; }
export const projectXAuth: ExchangeAuth = { ... };

// AFTER: factory that returns an isolated closure
export interface ProjectXHelpers {
  getBaseUrl(): string;
  getUserApiBaseUrl(): string;
  getRtcBaseUrl(): string;
  getToken(): string | null;
  authHeaders(): Record<string, string>;
  getUserId(): number | null;
}

export function createProjectXAuth(): { auth: ExchangeAuth; helpers: ProjectXHelpers } {
  const state = { token: null as string | null, baseUrl: DEFAULT_BASE_URL, userId: null as number | null };
  const helpers: ProjectXHelpers = {
    getBaseUrl:        () => state.baseUrl,
    getUserApiBaseUrl: () => state.baseUrl.replace('//api.', '//userapi.'),
    getRtcBaseUrl:     () => state.baseUrl.replace('//api.', '//rtc.'),
    getToken:          () => state.token,
    authHeaders:       () => ({ Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }),
    getUserId:         () => state.userId,
  };
  const auth: ExchangeAuth = {
    async connect({ credentials, baseUrl }) { /* writes to `state`, not module global */ },
    disconnect()   { state.token = null; state.userId = null; },
    isConnected()  { return state.token !== null; },
    getStatus()    { return { connected: state.token !== null, baseUrl: state.baseUrl }; },
    getRealtimeCredentials() {
      if (!state.token) return null;
      return { token: state.token, rtcBaseUrl: helpers.getRtcBaseUrl() };
    },
  };
  return { auth, helpers };
}
```

`getRealtimeCredentials()` is a new optional method on `ExchangeAuth` — added to `adapters/types.ts`.

---

### 2. Per-Instance Sub-Modules

Each sub-module (`accounts.ts`, `orders.ts`, `positions.ts`, `trades.ts`, `marketData.ts`) becomes a factory that accepts `ProjectXHelpers`:

```ts
// BEFORE
import { getBaseUrl, authHeaders } from './auth';
export const projectXOrders: ExchangeOrders = { ... };

// AFTER
import type { ProjectXHelpers } from './auth';
export function createProjectXOrders(h: ProjectXHelpers): ExchangeOrders {
  return {
    place(params) { return axios.post(`${h.getBaseUrl()}/api/Order/place`, ..., { headers: h.authHeaders() }); },
    // ...
  };
}
```

---

### 3. Adapter Factory (`adapters/projectx/index.ts`)

```ts
export function createProjectXAdapter(): ExchangeAdapter {
  const { auth, helpers } = createProjectXAuth();
  return {
    name: 'projectx',
    auth,
    accounts:    createProjectXAccounts(helpers),
    marketData:  createProjectXMarketData(helpers),
    orders:      createProjectXOrders(helpers),
    positions:   createProjectXPositions(helpers),
    trades:      createProjectXTrades(helpers),
  };
}
```

Each call to `createProjectXAdapter()` is fully independent — no shared state.

---

### 4. Registry & Connection IDs (`adapters/registry.ts`)

**Current**: `setAdapter('projectx', adapter)` — only one projectx connection possible.

**New**: use the **username** as the connection ID (e.g. `'alice'`, `'bob'`), so multiple ProjectX connections can coexist:

```ts
setAdapter('alice', aliceAdapter);
setAdapter('bob',   bobAdapter);
```

Add account → connection routing:

```ts
const accountToConnection = new Map<string, string>(); // accountId → connectionId

export function registerAccountConnection(accountId: string, connectionId: string): void {
  accountToConnection.set(accountId, connectionId);
}

export function getAdapterForAccount(accountId: string): ExchangeAdapter {
  const connId = accountToConnection.get(accountId);
  return getAdapter(connId); // falls back to default if not found
}
```

---

### 5. Auth Routes (`routes/authRoutes.ts`)

On `POST /auth/connect`:

1. Extract `username` from credentials.
2. Use `username` as the `connectionId` (not the exchange name).
3. After `connect()`, call `adapter.accounts.list()` to get account IDs, then `registerAccountConnection(accountId, username)` for each.
4. Pass realtime credentials to `realtimeService.connect()` if it's not already running.

```ts
const connectionId = credentials['username'];  // e.g. 'alice'
const adapter = createAdapter(exchange);
await adapter.auth.connect({ exchange, credentials, baseUrl });
setAdapter(connectionId, adapter);

// Register accounts for routing
const accountsData = await adapter.accounts.list();
for (const acct of accountsData.accounts ?? []) {
  registerAccountConnection(String(acct.id), connectionId);
}

// Start SignalR once (uses first connected account's token)
if (!realtimeService.isRunning()) {
  const rtCreds = adapter.auth.getRealtimeCredentials?.();
  if (rtCreds) {
    realtimeService.connect(rtCreds.token, rtCreds.rtcBaseUrl).catch(...);
  }
}
```

---

### 6. Middleware — Account-Based Routing (`middleware/withConnection.ts`)

```ts
export function resolveAdapter(req: Request): ExchangeAdapter {
  // 1. Route by accountId (present in most order/trade/position requests)
  const accountId =
    (req.body?.accountId as string | undefined) ??
    (req.query['accountId'] as string | undefined);
  if (accountId) return getAdapterForAccount(accountId);

  // 2. Fall back to explicit exchange or default
  const exchangeId =
    (req.query['exchange'] as string | undefined) ??
    (req.body?.exchange as string | undefined);
  return getAdapter(exchangeId);
}
```

All existing routes (`orderRoutes`, `positionRoutes`, `tradeRoutes`) already pass `accountId` — no route changes needed.

---

### 7. RealtimeService (`services/realtimeService.ts`)

**Current**: imports `getToken, getRtcBaseUrl` directly from `adapters/projectx/auth` module — hard-coded to the global singleton.

**New**: accept explicit credentials at connect time:

```ts
// BEFORE
import { getRtcBaseUrl, getToken } from '../adapters/projectx/auth';
async connect() {
  const rtcBase = getRtcBaseUrl();
  this.marketHub = new signalR.HubConnectionBuilder()
    .withUrl(`${rtcBase}/hubs/market`, { accessTokenFactory: () => getToken() ?? '' })
    ...
}

// AFTER — no import from auth module
async connect(token: string, rtcBaseUrl: string) {
  this.marketHub = new signalR.HubConnectionBuilder()
    .withUrl(`${rtcBaseUrl}/hubs/market`, { accessTokenFactory: () => token })
    ...
}
```

Only one SignalR session is maintained. Subsequent `connect()` calls when already running are no-ops (or ignored — SignalR allows only one session per ProjectX account anyway).

---

### 8. Credential Storage (`routes/credentialRoutes.ts`)

**Current**: single `.credentials.enc` file storing `{ userName, apiKey }`.

**New**: store an **array** of profiles — same AES-256-GCM encryption, same machine-derived key:

```ts
// File format (after decryption):
[
  { id: "alice", userName: "alice", apiKey: "...", baseUrl: "https://api.topstepx.com", label: "50K Combine" },
  { id: "bob",   userName: "bob",   apiKey: "...", baseUrl: "https://api.topstepx.com", label: "150K Combine" }
]
```

New routes:

| Method | Path | Action |
|--------|------|--------|
| `GET`    | `/credentials`         | Return full array |
| `PUT`    | `/credentials/:id`     | Upsert one profile by ID |
| `DELETE` | `/credentials/:id`     | Remove one profile |
| `DELETE` | `/credentials`         | Remove all |

Migration: on first `GET`, if the decrypted content is an object (not an array), wrap it in an array automatically.

---

## Frontend Changes

### 9. `credentialService.ts`

```ts
export interface CredentialProfile {
  id: string;        // username used as stable key
  userName: string;
  apiKey: string;
  baseUrl?: string;
  label?: string;    // display name (optional)
}

export const credentialService = {
  async loadAll(): Promise<CredentialProfile[]>,
  async save(profile: CredentialProfile): Promise<void>,
  async remove(id: string): Promise<void>,
  async clear(): Promise<void>,
};
```

---

### 10. `authService.ts`

```ts
// Connect one profile
connect(userName, apiKey, baseUrl?, exchange?): Promise<void>  // unchanged signature

// Disconnect specific connection
disconnect(connectionId?: string): Promise<void>               // unchanged

// Status now returns per-connection info
getStatus(): Promise<AuthStatus>  // AuthStatus.exchanges is map of connectionId → status
```

No signature changes needed — backend already accepts per-exchange connect/disconnect.

---

### 11. `connectionSlice.ts`

Add a `connections` array to track active connections (distinct from `accounts` which are trading accounts):

```ts
export interface ConnectionProfile {
  id: string;            // username / connectionId
  userName: string;
  label?: string;
  baseUrl: string;
  status: 'connected' | 'connecting' | 'error';
  errorMessage?: string;
}

// New state fields:
connections: ConnectionProfile[];
addConnection: (profile: ConnectionProfile) => void;
removeConnection: (id: string) => void;
updateConnection: (id: string, patch: Partial<ConnectionProfile>) => void;

// `connected` becomes a derived convenience: connections.some(c => c.status === 'connected')
```

`accounts[]` stays as-is — it holds all trading accounts aggregated from all connections.

---

### 12. `SettingsModal.tsx` — Data Feed Tab

Replaces the single username/apiKey form with a profile list + add form:

```
CONNECTIONS
┌────────────────────────────────────────────────────────────────────────┐
│  ● Alice (50K Combine)    TopstepX  api.topstepx.com  [Disconnect] [✕] │
│  ○ Bob (150K Combine)     TopstepX  api.topstepx.com  [Connect]    [✕] │
└────────────────────────────────────────────────────────────────────────┘
[+ Add Connection]

── expanded Add Connection form ──────────────────────────────────────────
Username   [__________]    API Key  [__________]
Label      [__________]    Gateway  [__________]  ← defaults to topstepx URL
[✓] Remember credentials
                                       [Cancel]  [Connect]
```

- Each row: status dot, label (or username), exchange, gateway URL, action buttons
- `[Disconnect]` calls `authService.disconnect(id)` + removes from `connections[]`
- `[✕]` removes saved profile from credentials file (and disconnects if active)
- `[Connect]` re-connects a saved-but-disconnected profile
- Connect form is collapsible (hidden by default, shown when `[+ Add Connection]` clicked)

---

### 13. `App.tsx` — Startup Auto-Connect

```ts
useEffect(() => {
  authService.getStatus().then(async (status) => {
    // Restore backend-connected adapters (e.g. after page refresh)
    if (status.connected) {
      const accounts = await accountService.searchAccounts();
      useStore.getState().setAccounts(accounts);
      // Rebuild connections[] from status.exchanges
      for (const [id, s] of Object.entries(status.exchanges ?? {})) {
        useStore.getState().addConnection({ id, userName: id, baseUrl: s.baseUrl, status: 'connected' });
      }
      useStore.getState().setConnected(true);
    }
  });

  // Auto-connect saved profiles that have remembered credentials
  credentialService.loadAll().then((profiles) => {
    for (const p of profiles) {
      authService.connect(p.userName, p.apiKey, p.baseUrl)
        .then(() => { /* add to connections[], load accounts */ })
        .catch((err) => { /* mark profile as error */ });
    }
  });
}, []);
```

---

## Files Modified

| File | Change |
|------|--------|
| `backend/src/adapters/types.ts` | Add `getRealtimeCredentials?()` to `ExchangeAuth` |
| `backend/src/adapters/registry.ts` | Add `accountToConnection` map, `registerAccountConnection`, `getAdapterForAccount` |
| `backend/src/adapters/projectx/auth.ts` | `const store` → `createProjectXAuth()` factory |
| `backend/src/adapters/projectx/accounts.ts` | `projectXAccounts` → `createProjectXAccounts(helpers)` |
| `backend/src/adapters/projectx/orders.ts` | `projectXOrders` → `createProjectXOrders(helpers)` |
| `backend/src/adapters/projectx/positions.ts` | `projectXPositions` → `createProjectXPositions(helpers)` |
| `backend/src/adapters/projectx/trades.ts` | `projectXTrades` → `createProjectXTrades(helpers)` |
| `backend/src/adapters/projectx/marketData.ts` | `projectXMarketData` → `createProjectXMarketData(helpers)` |
| `backend/src/adapters/projectx/index.ts` | Wire per-instance factories together |
| `backend/src/services/realtimeService.ts` | Remove direct `auth` import; `connect(token, rtcBaseUrl)` |
| `backend/src/routes/authRoutes.ts` | Use `username` as connectionId; register account→connection; start SignalR once |
| `backend/src/routes/credentialRoutes.ts` | Multi-profile array storage; add `/:id` upsert + delete routes; migration shim |
| `backend/src/routes/accountRoutes.ts` | Aggregate accounts from all connected adapters |
| `backend/src/middleware/withConnection.ts` | `resolveAdapter` checks `accountId` first via `getAdapterForAccount` |
| `frontend/src/services/credentialService.ts` | Multi-profile `CredentialProfile[]` API |
| `frontend/src/services/authService.ts` | Minor: `getStatus` already handles multi-exchange |
| `frontend/src/store/slices/connectionSlice.ts` | Add `connections[]`, `addConnection`, `removeConnection`, `updateConnection` |
| `frontend/src/components/SettingsModal.tsx` | Data Feed tab: profile list + collapsible add form |
| `frontend/src/App.tsx` | Startup: restore from status + auto-connect saved profiles |

---

## What Does NOT Change

- **Account selector (TopBar)**: already shows a flat list of all accounts — accounts from multiple connections naturally merge in.
- **All order/position/trade routes**: already pass `accountId`; routing is handled transparently in `resolveAdapter`.
- **SignalR event subscriptions**: `realtimeService` subscribes to all accounts after connecting — no change needed.
- **Demo mode**: `IS_DEMO` path is unaffected.
