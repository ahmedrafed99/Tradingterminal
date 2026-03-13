# Feature: API Settings

A modal dialog accessible via the gear icon ⚙ in the top bar.
Lets the user enter credentials, choose environment, and manage the
connection to the ProjectX Gateway.

---

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                           [✕]  │
│  API   Database   Sound                                  │
│  ───                                                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ● Connected · https://api.topstepx.com                  │
│                                                          │
│  CONNECTION                                              │
│  Username                                                │
│  [ your-projectx-username                ]               │
│  API Key                                                 │
│  [ ••••••••••••••••                      ]               │
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

The modal uses a tabbed layout shared with the Database and Sound tabs. Design matches the BracketSettingsModal language: `bg-(--color-surface)`, `border-(--color-border)`, translucent glass inputs (`bg-white/[0.05] border-white/10`), soft accent buttons, 28px section spacing.

---

## Components

### `SettingsModal`
Top-level modal with three tabs (API, Database, Sound). Uses the shared `<Modal>` component (`shared/Modal.tsx`) for backdrop, Escape key, and click-outside behavior. Input fields use translucent glass styling (`bg-white/[0.05] border border-white/10`) matching the BracketSettingsModal design language.

### `CredentialsForm` (API tab)
- **Username** text input
- **API Key** password input
- **Gateway URL** — defaults to `https://api.topstepx.com`
- **Condition Server URL** — always editable, defaults to `http://localhost:3001`
- Credentials sent to proxy `POST /auth/connect` — **never stored in
  the browser or localStorage**

### `ConnectionStatus`
- Displays current state: Connected / Connecting / Disconnected / Error
- Shows account name when connected
- Error message if login failed (e.g. "Invalid API key")

### `ConnectButton` / `DisconnectButton`
- **Connect**: submits credentials → proxy authenticates → SignalR connects
- **Disconnect**: calls proxy `POST /auth/disconnect` → clears server-side
  token → SignalR hub disconnected

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
  isConnected: boolean
  username: string
  environment: 'demo' | 'live'
  setConnected: (v: boolean) => void
  setEnvironment: (e: Environment) => void
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

1. App opens → frontend calls `GET /auth/status`
2. If proxy has a live token → TopBar shows connected; accounts loaded
3. If no token → TopBar shows disconnected; Settings modal prompts user
4. On successful connect → accounts list fetched; SignalR hubs opened
5. On disconnect (manual or SignalR drop) → orders / positions cleared from store
