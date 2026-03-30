# Volume Profile Indicator

Volume Profile displays a horizontal histogram of volume traded at each price level. Unlike bar volume (total volume per time period), VP shows where the most trading activity occurred by price, revealing support/resistance zones and high-interest price levels.

**Status:** Implemented and working (2026-02-26)

## Data Source

**SignalR Market Hub — GatewayDepth event**

The VP uses session volume-at-price data from the TopstepX/ProjectX SignalR Market Hub via `SubscribeContractMarketDepth`. This provides full session data on subscribe — no third-party data source needed.

- **Subscribe**: `SubscribeContractMarketDepth(contractId)` on the Market Hub
- **Event**: `GatewayDepth(contractId, entries[])` — two params (like GatewayQuote)
- **Entry shape**: `{ price, volume, currentVolume, type, timestamp }`

**How it works:**
1. On subscribe, the first event is a reset marker (type 6, price=0)
2. The second event is a **snapshot** containing all price levels traded in the current session (600+ entries typical for NQ)
3. Subsequent events are incremental updates (1-4 entries each) as new trades occur

**Type values:**
| Type | Meaning |
|------|---------|
| 3 | Best Ask |
| 4 | Best Bid |
| 5 | **Volume at Price** (session total) |
| 6 | Reset/Init marker (price=0) |
| 7 | Session Low |
| 8 | Session High |

**Key fields for Volume Profile:**
- Type 5 entries: `price` = price level, `volume` = total session volume at that price, `currentVolume` = 1 if a trade just happened at this price (0 otherwise)
- The snapshot gives the full session VP immediately — no need to wait for live accumulation
- Incremental type 5 updates have the updated `volume` total, so just overwrite the price level

**Important:** Some entries in the array may be `null` — always filter before processing.

**Test script:**
```bash
cd backend
npx tsx scripts/test-gateway-depth.ts <contractId>
# Example: npx tsx scripts/test-gateway-depth.ts CON.F.US.ENQ.H26
```

---

## Frontend Architecture

### Files

```
frontend/src/
├── components/chart/
│   ├── VolumeProfilePrimitive.ts   ← LWC ISeriesPrimitive (renderer + data)
│   ├── ChartToolbar.tsx            ← IndicatorsDropdown (toggle + color edit)
│   ├── ColorPopover.tsx            ← Shared color palette (used by VP + drawings)
│   └── CandlestickChart.tsx        ← Depth subscription, hover tracking, color sync
├── store/
│   └── useStore.ts                 ← VolumeProfileState slice (per-chart vpEnabled/vpColor, vpTradeMode)
└── services/
    └── realtimeService.ts          ← DepthEntry type, subscribe/unsubscribe depth, handlers
```

### VolumeProfilePrimitive (`ISeriesPrimitive<Time>`)

The core rendering component, attached to the candlestick series.

**Public API:**
```ts
setTickSize(tickSize: number): void       // Set contract tick size (e.g. 0.25)
setEnabled(enabled: boolean): void        // Show/hide the VP overlay
setColor(color: string): void              // Set bar color from hex or rgba string
setHoverExpand(enabled: boolean): void    // Toggle smooth bar expansion on hover
setVolumeMap(map: VolumeMap): void        // Replace entire volume map (snapshot)
updateLevel(price: number, vol: number): void  // Update single price level (incremental)
clear(): void                             // Clear all data (contract change / reset)
setHoverPrice(price: number | null): void // Feed crosshair price for hover effects
getVolumeMap(): VolumeMap                 // Get current data (for hit-testing)
isEnabled(): boolean                      // Check if VP is currently on
```

**Rendering details:**
- Bars drawn from left edge, width proportional to volume (`volumeRatio * paneWidth * 0.30`)
- Color accepts hex or rgba — user opacity is used as a multiplier on internal alpha values (bars `0.22`, hover `0.40`, ref line `0.25`)
- Two separate pane views for correct layering:
  - **Bars view** (`zOrder: 'bottom'`) — histogram bars + dotted reference line, renders behind candles
  - **Tooltip view** (`zOrder: 'top'`) — volume label on hover, renders above candles
- Hover expand: when enabled, hovered bar smoothly grows ±3px using lerp animation (0.25/frame), shared expand map between both views
- Volume tooltip positioned at the left edge of bars (4px padding)
- Width calculated in renderer via `mediaSize.width` (no hacky chart width access)

### Store State (`VolumeProfileState`)

```ts
vpEnabled: boolean        // Left chart toggle (persisted)
vpTradeMode: boolean      // Click-to-trade mode (not yet implemented)
vpColor: string           // Left chart color as hex or rgba (persisted)
vpHoverExpand: boolean    // Smooth bar expansion on hover, default true (persisted)
secondVpEnabled: boolean  // Right chart toggle (persisted)
secondVpColor: string     // Right chart color as hex or rgba (persisted)
secondVpHoverExpand: boolean // Right chart hover expand (persisted)
```

In dual-chart mode, each chart reads its own VP state (`vpEnabled`/`vpColor` for left, `secondVpEnabled`/`secondVpColor` for right). The `IndicatorsDropdown` routes to the selected chart's state via `selectedChart`, matching the timeframe routing pattern. In single-chart mode, `selectedChart` is always `'left'`, so the primary state is used.

### CandlestickChart Integration

Three `useEffect` hooks manage the VP lifecycle:

1. **Depth subscription** (deps: `[contract, vpEnabled]`)
   - Subscribes to `SubscribeContractMarketDepth` when VP is enabled
   - Handles type 6 (reset → clear) and type 5 (volume at price → updateLevel)
   - Cleans up subscription on disable or contract change

2. **Color sync** (deps: `[vpColor]`)
   - Separate from subscription so color changes don't re-subscribe depth
   - Calls `vpPrimitive.setColor(vpColor)` — accepts hex or rgba

3. **Hover expand sync** (deps: `[vpHoverExpand]`)
   - Calls `vpPrimitive.setHoverExpand(vpHoverExpand)`

4. **Hover tracking** (deps: `[vpEnabled]`)
   - Subscribes to `chart.subscribeCrosshairMove`
   - Converts crosshair Y → price via `series.coordinateToPrice()`
   - Feeds price to `vpPrimitive.setHoverPrice()`

---

## UI Controls

### Indicators Dropdown (ChartToolbar)

Located in the top toolbar after the timeframe selectors. Contains a list of available indicators.

**Volume Profile row:**
- **Checkbox** — toggles VP on/off (`vpEnabled`)
- **Label** — "Volume Profile" (also toggles on click)
- **Color swatch** — shows current `vpColor`
- **Pencil edit button** — opens color palette sub-view

**Settings sub-view (pencil icon):**
- Back arrow returns to indicator list
- **Color** section: 7×10 color grid (same `COLOR_PALETTE` used by drawing tools), custom color picker (+), opacity slider
- **Hover Expand** toggle: enables/disables smooth bar expansion on hover (persisted)

---

## Rendering

- Horizontal histogram bars anchored to the **left edge** of the chart
- Bar width proportional to volume (max width ~30% of chart area)
- Default color: grey (`#808080`), customizable via Indicators dropdown
- Hover: bar brightens (and optionally expands smoothly), volume tooltip appears at left edge above candles, dotted reference line extends across chart
- Per-chart toggle: in dual-chart mode, each chart has independent `vpEnabled`/`vpColor` state; toolbar routes to the selected chart
- Each bar spans one tick in height (price ± tickSize/2)

---

## VP Trade Mode

**Not yet implemented.**

When enabled, clicking a VP bar will place a limit order at that price level:
- Click below current price = Buy limit
- Click above current price = Sell limit
- Uses the order size configured in the Order Panel

The `vpTradeMode` state exists in the store but the click-to-order logic is not wired up.
