// ---------------------------------------------------------------------------
// Exchange-agnostic enums
// ---------------------------------------------------------------------------
// These replace raw numeric literals throughout the codebase.
// The numeric values match the ProjectX gateway today; a future adapter
// layer (Phase 2+) will translate between these and exchange-specific codes.

/** Order type on the exchange */
export enum OrderType {
  Limit        = 1,
  Market       = 2,
  Stop         = 4,
  TrailingStop = 5,
}

/** Order / trade side */
export enum OrderSide {
  Buy  = 0,
  Sell = 1,
}

/** Order lifecycle status */
export enum OrderStatus {
  Filled    = 2,
  Cancelled = 3,
  Rejected  = 4,
  Expired   = 5,
  Pending   = 6,
}

/** Position direction */
export enum PositionType {
  Long  = 1,
  Short = 2,
}

/** Market depth entry classification */
export enum DepthType {
  BestAsk       = 3,
  BestBid       = 4,
  VolumeAtPrice = 5,
  Reset         = 6,
  SessionLow    = 7,
  SessionHigh   = 8,
}
