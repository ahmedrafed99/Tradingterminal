import { z } from 'zod';

// ---------------------------------------------------------------------------
// Condition schemas
// ---------------------------------------------------------------------------

export const ConditionTypeEnum = z.enum(['closes_above', 'closes_below']);

export const OrderSideEnum = z.enum(['buy', 'sell']);

export const OrderTypeEnum = z.enum(['market', 'limit']);

export const BracketSchema = z.object({
  enabled: z.boolean(),
  sl: z.object({ points: z.number().positive() }).optional(),
  tp: z
    .array(z.object({ points: z.number().positive(), size: z.number().positive().optional() }))
    .optional(),
});

/** Schema for creating a new condition (client → server). */
export const CreateConditionSchema = z.object({
  contractId: z.string(),
  contractTickSize: z.number().positive(),
  conditionType: ConditionTypeEnum,
  triggerPrice: z.number(),
  timeframe: z.string(),             // e.g. "1m", "5m", "15m", "1h", "4h", "1d"
  orderSide: OrderSideEnum,
  orderType: OrderTypeEnum,
  orderPrice: z.number().optional(),  // required when orderType === 'limit'
  orderSize: z.number().positive(),
  accountId: z.string(),
  bracket: BracketSchema.optional(),
  expiresAt: z.string().optional(),   // ISO 8601 datetime
  label: z.string().optional(),       // user-defined label
});

/** Schema for patching an existing condition (partial update). */
export const PatchConditionSchema = CreateConditionSchema.partial();

// ---------------------------------------------------------------------------
// Derived TypeScript types
// ---------------------------------------------------------------------------

export type ConditionType = z.infer<typeof ConditionTypeEnum>;
export type CreateConditionInput = z.infer<typeof CreateConditionSchema>;
export type PatchConditionInput = z.infer<typeof PatchConditionSchema>;
export type Bracket = z.infer<typeof BracketSchema>;

export type ConditionStatus = 'armed' | 'triggered' | 'failed' | 'expired' | 'paused';

export interface Condition extends CreateConditionInput {
  id: string;
  status: ConditionStatus;
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  triggeredAt?: string;     // ISO 8601
  errorMessage?: string;    // set on 'failed'
}
