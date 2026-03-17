# Feature: Data Feed Settings

A modal dialog accessible via the gear icon in the top bar.
Lets the user select a data feed provider, enter credentials, and manage the
connection to the exchange gateway.

---

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                           [✕]  │
│  Data Feed   Database   Sound   Shortcuts   Recording    │
│  ─────────                                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  PROVIDER                                                │
│  [ TopstepX by ProjectX              ▾]                  │
│                                                          │
│  ● Connected · https://api.topstepx.com                  │
│                                                          │
│  CREDENTIALS                                             │
│  Username                                                │
│  [ your-projectx-username                ]               │
│  API Key                                                 │
│  [ ••••••••••••••••                      ]               │
│  [✓] Remember credentials                               │
│  Gateway URL                                             │
│  [ https://api.topstepx.com             ]                │
│                                                          │
│  CONDITION SERVER                                        │
│  Server URL                                              │
│  [ http://localhost:3001                 ]                │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                          [ Cancel ]  [ Connect ]         │
└──────────────────────────────────────────────────────────┘
```

The modal uses a tabbed layout shared with the Database, Sound, Shortcuts, and Recording tabs. Design matches the BracketSettingsModal language: `bg-(--color-surface)`, `border-(--color-border)`, translucent glass inputs (`bg-white/[0.05] border-white/10`), soft accent buttons, 28px section spacing.

---

## Components

### `SettingsModal`
Top-level modal with five tabs (Data Feed, Database, Sound, Shortcuts, Recording). Uses the shared `<Modal>` component (`shared/Modal.tsx`) for backdrop, Escape key, and click-outside behavior. Input fields use translucent glass styling (`bg-white/[0.05] border border-white/10`) matching the BracketSettingsModal design language.

### Data Feed tab
- **Provider** dropdown — selects exchange data feed (currently: "TopstepX by ProjectX"). Disabled while connected.
- **Username** text input
- **API Key** password input
- **Remember credentials** checkbox — when enabled, username and API key are persisted to the backend settings file and auto-filled on next app load. Unchecking clears saved credentials immediately.
- **Gateway URL** — defaults to `https://api.topstepx.com`
- **Condition Server URL** — always editable, defaults to `http://localhost:3001`
- Credentials sent to proxy `POST /auth/connect` — only persisted to the backend settings file when "Remember credentials" is checked

### `ConnectionStatus`
- Displays current state: Connected / Connecting / Disconnected / Error
- Shows gateway URL when connected
- Error message if login failed (e.g. "Invalid API key")

### `ConnectButton` / `DisconnectButton`
- **Connect**: submits credentials → proxy authenticates → sets `connected` with the entered URL (no separate `getStatus` call) → fetches accounts → SignalR connects. If "Remember credentials" is checked, saves credentials to backend settings file on success.
- **Disconnect**: tears down SignalR WebSocket connections first, then calls proxy `POST /auth/disconnect` → clears server-side token

---

## Security Design

```
Browser                   Proxy (localhost:3001)         ProjectX API
──────                    ──────────────────────         ────────────
POST /auth/connect  ───►  POST /api/Auth/loginKey  ───►  { token }
{ username, apiKey }      stores token in memory
                     ◄───  { ok: true }
                          uses stored token for all
                          subsequent forwarded calls
```

- The raw `apiKey` is transmitted once (over localhost) and held only in proxy
  memory
- The proxy returns a session cookie (`httpOnly`, `sameSite=strict`) so the
  browser can authenticate future proxy requests without re-sending the key
- On proxy restart the token is lost; the user must reconnect
- `username` may optionally be persisted to `localStorage` for convenience
  (not the API key)

---

## State (Zustand)

```ts
interface AuthState {
  connected: boolean
  baseUrl: string
  rememberCredentials: boolean
  savedUserName: string
  savedApiKey: string
  setConnected: (connected: boolean, baseUrl?: string) => void
  setRememberCredentials: (on: boolean) => void
  setSavedCredentials: (userName: string, apiKey: string) => void
}
```

---

## Proxy Endpoints (Express)

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/connect | Accept { username, apiKey, env }, call loginKey, store token |
| POST | /auth/disconnect | Clear stored token, close SignalR connection |
| GET | /auth/status | Return { connected, environment } — called on app load |

---

## Behavior

1. App opens → full trading UI renders immediately (empty state, no connection gate)
2. Frontend calls `GET /auth/status` — if proxy has a live token, sets connected and loads accounts (single `searchAccounts` call in `App.tsx`)
3. If no token → UI stays in empty state; user opens Settings → Data Feed to connect
4. On successful connect → SettingsModal fetches accounts, sets `connected` using the entered URL (no extra `getStatus` call); NQ auto-loaded in a single search that sets both chart and order panel contracts; SignalR hubs opened; chart subscriptions start
5. On disconnect → SignalR WebSocket connections torn down first, then proxy token cleared, accounts/orders/positions cleared from store
6. On reconnect (connect after disconnect) → SignalR subscriptions (quotes, depth, user events) re-established automatically via `connected` dependency in effects
