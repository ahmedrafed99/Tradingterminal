// ---------------------------------------------------------------------------
// Exchange-agnostic enums
// ---------------------------------------------------------------------------
// These replace raw numeric literals throughout the codebase.
// The numeric values match the ProjectX gateway today; a future adapter
// layer (Phase 2+) will translate between these and exchange-specific codes.

/** Order type on the exchange */
export const OrderType = {
  Limit:        1,
  Market:       2,
  Stop:         4,
  TrailingStop: 5,
} as const;
export type OrderType = typeof OrderType[keyof typeof OrderType];

/** Order / trade side */
export const OrderSide = {
  Buy:  0,
  Sell: 1,
} as const;
export type OrderSide = typeof OrderSide[keyof typeof OrderSide];

/** Order lifecycle status (ProjectX gateway values) */
export const OrderStatus = {
  Working:   1,  // Order is open and working on the exchange
  Filled:    2,
  Cancelled: 3,
  Rejected:  4,
  Expired:   5,
  Pending:   6,  // Accepted but not yet confirmed working
  Suspended: 8,  // Order suspended pending parent fill (gateway term for contingent SL/TP bracket legs)
} as const;
export type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus];

/** Position direction */
export const PositionType = {
  Long:  1,
  Short: 2,
} as const;
export type PositionType = typeof PositionType[keyof typeof PositionType];

/** Market depth entry classification */
export const DepthType = {
  BestAsk:       3,
  BestBid:       4,
  VolumeAtPrice: 5,
  Reset:         6,
  SessionLow:    7,
  SessionHigh:   8,
} as const;
export type DepthType = typeof DepthType[keyof typeof DepthType];
