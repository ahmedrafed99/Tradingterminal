// ---------------------------------------------------------------------------
// Exchange-agnostic enums (backend copy)
// ---------------------------------------------------------------------------
// Keep in sync with frontend/src/types/enums.ts.
// Phase 2 will consolidate into a shared package.

export enum OrderType {
  Limit        = 1,
  Market       = 2,
  Stop         = 4,
  TrailingStop = 5,
}

export enum OrderSide {
  Buy  = 0,
  Sell = 1,
}
