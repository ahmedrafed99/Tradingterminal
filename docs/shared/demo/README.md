# Feature: Demo Mode

A fully self-contained demo that runs the real frontend with synthetic NQ data — no backend, no exchange connection, no internet required. Used to embed a live interactive preview in the portfolio at [ahmedabdulsattar.com](https://ahmedabdulsattar.com).

---

## How it works

Demo mode is activated at startup by calling `bootstrapDemoMode()` from `frontend/src/adapters/demo/index.ts`. This does two things before React renders:

1. **Replaces the axios adapter** — every REST call (`/auth/status`, `/accounts`, `/market/bars`, `/positions/open`, etc.) returns a hardcoded mock response without touching the network.
2. **Installs `DemoRealtimeAdapter`** — replaces the ProjectX SignalR adapter. No WebSocket connections are made. The adapter emits synthetic NQ price ticks at 280ms intervals and fires a fake long position + SL/TP bracket orders after a 400ms delay.

The rest of the app boots exactly as normal and never knows it's in demo mode.

### Key files

```
frontend/src/adapters/demo/
├── demoAdapter.ts   ← DemoRealtimeAdapter: price ticker, fake position/orders, handler registry
└── index.ts         ← bootstrapDemoMode(): axios mock adapter + adapter registry swap
```

### Demo data

| Item | Value |
|------|-------|
| Instrument | NQ (NASDAQ-100 E-MINI, `marketType: 'crypto'` so CME hours are bypassed) |
| Tick size | 0.25 |
| Position | Long 2 contracts @ 21,480.00 |
| Stop Loss | Sell Stop @ 21,440.00 |
| Take Profit | Sell Limit @ 21,560.00 |
| Account | `Demo — Apex PA`, balance $150,000 |
| Historical bars | 500 procedurally-generated 5m candles (random walk from ~21,350) |
| Price tick interval | 280ms, ±2.5pt random walk, snapped to 0.25 tick |
| Trade history | 3 synthetic closed trades (mix of wins/losses) |

> **Why `marketType: 'crypto'`?**  
> The chart's quote handler (`useChartBars.ts`) drops all ticks when `getSchedule(marketType).isOpen()` returns false. Futures use the CME schedule (closed nights/weekends). Setting `'crypto'` maps to `alwaysOpenSchedule` so the candle always updates regardless of real-world time.

---

## Activation

### URL parameter (dev or production)

```
http://localhost:5173/?demo=true
```

Any environment — just append `?demo=true`. Works alongside `?test=orderline`.

### Build-time env var

Set `VITE_DEMO=true` at build time. The app will always start in demo mode with no URL parameter needed.

```
frontend/.env.demo   →   VITE_DEMO=true
```

`main.tsx` checks both:
```ts
if (params.get('demo') === 'true' || import.meta.env.VITE_DEMO === 'true') {
  bootstrapDemoMode()
}
```

---

## Building the demo

```powershell
cd frontend
npm run build:demo
```

This runs `vite build --mode demo --base ./`, which:
- Loads `frontend/.env.demo` → `VITE_DEMO=true`
- Outputs to `frontend/dist/`
- Uses relative asset paths (`./assets/...`) so it works from any subdirectory

---

## Deploying to the portfolio

The portfolio site (`c:\Users\ahmed\projects\portfolio\portfolio\`) serves demo files as local iframes. The trading terminal demo lives at `demos/trading-terminal/index.html`.

### Build and copy

```powershell
# 1. Build
cd c:\Users\ahmed\projects\tradingterminal\frontend
npm run build:demo

# 2. Replace the old copy
Remove-Item ..\..\portfolio\portfolio\demos\trading-terminal -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item dist ..\..\portfolio\portfolio\demos\trading-terminal -Recurse
```

### Portfolio entry (`index.html`)

The card is the first item in `#portfolio .portfolio-grid`:

```html
<div class="portfolio-item demo-item reveal">
  <div class="portfolio-demo-wrap">
    <iframe
      src="trading-terminal/index.html"
      title="Prop Trading Terminal — live demo"
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-forms"
    ></iframe>
  </div>
  ...
</div>
```

`allow-forms` is required in addition to the standard `allow-scripts allow-same-origin` because Zustand's `persist` middleware writes to `localStorage` (same-origin) and some input interactions trigger form-related browser behaviour.

---

## Adding a new mock endpoint

All REST mocks live in the `demoAxiosAdapter` function in `frontend/src/adapters/demo/index.ts`. Add a new `if` branch:

```ts
if (url.includes('/my/endpoint')) {
  return mockResp({ myData: [...], success: true }, config);
}
```

The catch-all at the bottom silently returns `{ success: true }` for any unmatched URL, so unhandled endpoints never crash the app.

---

## Adding new fake realtime events

Open `frontend/src/adapters/demo/demoAdapter.ts` and emit from inside `subscribeUserEvents` or `_startTicking`:

```ts
// Emit an additional working order
this.orderH.fire(
  {
    id: 'demo-extra',
    accountId: DEMO_ACCOUNT_ID,
    contractId: DEMO_CONTRACT_ID,
    status: OrderStatus.Working,
    type: OrderType.Limit,
    side: OrderSide.Buy,
    size: 1,
    limitPrice: 21_400,
  },
  0, // action 0 = new/update
);
```

Handler signatures match `frontend/src/adapters/types.ts` exactly.
