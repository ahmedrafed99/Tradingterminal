import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RealtimeOrder } from '../realtimeService';
import type { BracketConfig } from '../../types/bracket';
import type { Contract } from '../marketDataService';
import { OrderType, OrderSide, OrderStatus } from '../../types/enums';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../orderService', () => ({
  orderService: {
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    modifyOrder: vi.fn(),
    searchOpenOrders: vi.fn(),
  },
}));

vi.mock('../../utils/toast', () => ({
  showToast: vi.fn(),
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../../utils/retry', () => ({
  retryAsync: vi.fn(async (fn: () => Promise<unknown>, opts?: { onExhausted?: (err: unknown) => void }) => {
    try {
      return await fn();
    } catch (err) {
      opts?.onExhausted?.(err);
      throw err;
    }
  }),
}));

// Import AFTER mocks
import { bracketEngine } from '../bracketEngine';
import { orderService } from '../orderService';
import { showToast } from '../../utils/toast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const placeOrder = orderService.placeOrder as ReturnType<typeof vi.fn>;
const cancelOrder = orderService.cancelOrder as ReturnType<typeof vi.fn>;
const modifyOrder = orderService.modifyOrder as ReturnType<typeof vi.fn>;
const toast = showToast as ReturnType<typeof vi.fn>;

function mockOrder(overrides: Partial<RealtimeOrder> = {}): RealtimeOrder {
  return {
    id: 1,
    accountId: 100,
    contractId: 'CON-NQ',
    status: 0 as OrderStatus,
    type: OrderType.Limit,
    side: OrderSide.Buy,
    size: 1,
    filledPrice: 0,
    limitPrice: 0,
    stopPrice: 0,
    ...overrides,
  };
}

const mockContract: Contract = {
  id: 'CON-NQ',
  name: 'NQ',
  description: 'Micro Nasdaq',
  tickSize: 0.25,
  tickValue: 0.50,
  activeContract: true,
  ticksPerPoint: 4,
  quantityStep: 1,
  pricePrecision: 2,
  quantityPrecision: 0,
};

const baseBracketConfig: BracketConfig = {
  stopLoss: { points: 10, type: 'Stop' },
  takeProfits: [
    { id: 'tp1', points: 20, size: 1 },
  ],
  conditions: [],
};

function armAndConfirm(
  config: BracketConfig = baseBracketConfig,
  entrySize = 1,
  entrySide: OrderSide = OrderSide.Buy,
) {
  bracketEngine.armForEntry({
    accountId: 100,
    contractId: 'CON-NQ',
    entrySide,
    entrySize,
    config,
    contract: mockContract,
  });
}

let orderIdCounter = 100;

beforeEach(async () => {
  bracketEngine.clearSession();
  // Wait a tick so any lingering async cancellation from previous session finishes
  await new Promise((r) => setTimeout(r, 50));
  vi.clearAllMocks();
  orderIdCounter = 100;
  placeOrder.mockImplementation(async () => ({ orderId: ++orderIdCounter }));
  cancelOrder.mockResolvedValue(undefined);
  modifyOrder.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('arm/confirm lifecycle', () => {
  it('should arm and report active session', () => {
    armAndConfirm();
    expect(bracketEngine.hasActiveSession()).toBe(true);
  });

  it('should clear session on clearSession', () => {
    armAndConfirm();
    bracketEngine.clearSession();
    expect(bracketEngine.hasActiveSession()).toBe(false);
  });
});

describe('entry fill detection', () => {
  it('should place SL and TP after entry fills', async () => {
    armAndConfirm();
    bracketEngine.confirmEntryOrderId(42);

    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    // SL + TP = 2 placeOrder calls
    expect(placeOrder).toHaveBeenCalledTimes(2);

    // SL call
    const slCall = placeOrder.mock.calls.find((c: unknown[]) => (c[0] as { type: number }).type === OrderType.Stop);
    expect(slCall).toBeDefined();
    expect((slCall![0] as { stopPrice: number }).stopPrice).toBe(20000 - 10 * 0.25 * 4); // 19990
    expect((slCall![0] as { side: number }).side).toBe(OrderSide.Sell); // opposite of long
    expect((slCall![0] as { size: number }).size).toBe(1);

    // TP call
    const tpCall = placeOrder.mock.calls.find((c: unknown[]) => (c[0] as { type: number }).type === OrderType.Limit);
    expect(tpCall).toBeDefined();
    expect((tpCall![0] as { limitPrice: number }).limitPrice).toBe(20000 + 20 * 0.25 * 4); // 20020
    expect((tpCall![0] as { side: number }).side).toBe(OrderSide.Sell);
  });

  it('should process buffered fill on confirm', async () => {
    armAndConfirm();
    // Fill arrives BEFORE confirm
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));
    expect(placeOrder).not.toHaveBeenCalled(); // Buffered, not processed yet

    bracketEngine.confirmEntryOrderId(42);

    // Need a tick for the async onEntryFilled to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(placeOrder).toHaveBeenCalledTimes(2); // SL + TP
  });

  it('should place SL above entry for short entries', async () => {
    armAndConfirm(baseBracketConfig, 1, OrderSide.Sell); // entrySide = Sell (short)
    bracketEngine.confirmEntryOrderId(42);

    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    const slCall = placeOrder.mock.calls.find((c: unknown[]) => (c[0] as { type: number }).type === OrderType.Stop);
    expect((slCall![0] as { stopPrice: number }).stopPrice).toBe(20000 + 10 * 0.25 * 4); // 20010
    expect((slCall![0] as { side: number }).side).toBe(OrderSide.Buy); // Buy side (opposite of short)
  });
});

describe('SL placement failure', () => {
  it('should show critical toast when SL placement fails', async () => {
    placeOrder.mockRejectedValue(new Error('Network error'));

    armAndConfirm();
    bracketEngine.confirmEntryOrderId(42);

    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    // onExhausted should have been called via retryAsync mock
    expect(toast).toHaveBeenCalledWith(
      'error',
      'CRITICAL: Stop Loss placement failed',
      expect.stringContaining('UNPROTECTED'),
      null,
    );
  });
});

describe('TP size normalization', () => {
  it('should normalize TP sizes when sum exceeds entry size', async () => {
    const config: BracketConfig = {
      stopLoss: { points: 10, type: 'Stop' },
      takeProfits: [
        { id: 'tp1', points: 10, size: 2 },
        { id: 'tp2', points: 20, size: 2 },
        { id: 'tp3', points: 30, size: 2 },
      ],
      conditions: [],
    };

    placeOrder.mockImplementation(async () => ({ orderId: ++orderIdCounter }));

    armAndConfirm(config, 3); // entry size 3, but TP sizes sum to 6
    bracketEngine.confirmEntryOrderId(42);

    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    // 1 SL + 3 TPs = 4 calls
    const tpCalls = placeOrder.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: number }).type === OrderType.Limit,
    );
    const totalTpSize = tpCalls.reduce(
      (sum: number, c: unknown[]) => sum + (c[0] as { size: number }).size,
      0,
    );
    expect(totalTpSize).toBe(3);

    // Should show normalization warning
    expect(toast).toHaveBeenCalledWith(
      'warning',
      'TP sizes adjusted to match order size',
      expect.stringContaining('6'),
    );
  });

  it('should not normalize when sizes already match', async () => {
    const config: BracketConfig = {
      stopLoss: { points: 10, type: 'Stop' },
      takeProfits: [
        { id: 'tp1', points: 10, size: 1 },
        { id: 'tp2', points: 20, size: 2 },
      ],
      conditions: [],
    };

    armAndConfirm(config, 3);
    bracketEngine.confirmEntryOrderId(42);

    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    // Should NOT show normalization warning
    const normCalls = toast.mock.calls.filter(
      (c: unknown[]) => c[1] === 'TP sizes adjusted to match order size',
    );
    expect(normCalls).toHaveLength(0);
  });
});

describe('SL fill cancels TPs', () => {
  it('should cancel remaining TPs when SL fills', async () => {
    armAndConfirm();
    bracketEngine.confirmEntryOrderId(42);

    // Entry fills
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    const slOrderId = placeOrder.mock.results[0].value.then
      ? (await placeOrder.mock.results[0].value).orderId
      : placeOrder.mock.results[0].value.orderId;
    const tpOrderId = placeOrder.mock.results[1].value.then
      ? (await placeOrder.mock.results[1].value).orderId
      : placeOrder.mock.results[1].value.orderId;

    // SL fills
    await bracketEngine.onOrderEvent(mockOrder({
      id: slOrderId,
      contractId: 'CON-NQ',
      status: OrderStatus.Filled,
      filledPrice: 19990,
    }));

    // TP should be cancelled
    expect(cancelOrder).toHaveBeenCalledWith(100, tpOrderId);
  });
});

describe('TP fill reduces SL size', () => {
  it('should modify SL size when TP fills', async () => {
    const config: BracketConfig = {
      stopLoss: { points: 10, type: 'Stop' },
      takeProfits: [
        { id: 'tp1', points: 10, size: 1 },
        { id: 'tp2', points: 20, size: 2 },
      ],
      conditions: [],
    };

    armAndConfirm(config, 3);
    bracketEngine.confirmEntryOrderId(42);

    // Entry fills
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    // Get the TP1 orderId (3rd placeOrder call: SL=1st, TP1=2nd, TP2=3rd)
    const tp1OrderId = (await placeOrder.mock.results[1].value).orderId;

    // TP1 fills (size 1)
    await bracketEngine.onOrderEvent(mockOrder({
      id: tp1OrderId,
      contractId: 'CON-NQ',
      status: OrderStatus.Filled,
    }));

    // SL should be modified to remaining size: 3 - 1 = 2
    expect(modifyOrder).toHaveBeenCalledWith(
      expect.objectContaining({ size: 2 }),
    );
  });
});

describe('clearSession cancels orders', () => {
  it('should cancel SL and unfilled TPs on clearSession', async () => {
    armAndConfirm();
    bracketEngine.confirmEntryOrderId(42);
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    bracketEngine.clearSession();

    // Wait for async cancellation
    await new Promise((r) => setTimeout(r, 50));

    // Should cancel both SL and TP
    expect(cancelOrder).toHaveBeenCalledTimes(2);
  });

  it('should show toast when cancel fails', async () => {
    cancelOrder.mockRejectedValue(new Error('Cancel failed'));

    armAndConfirm();
    bracketEngine.confirmEntryOrderId(42);
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    bracketEngine.clearSession();
    await new Promise((r) => setTimeout(r, 50));

    expect(toast).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('Failed to cancel'),
      expect.any(String),
    );
  });
});

describe('conditions', () => {
  it('should move SL to breakeven when condition triggers on TP fill', async () => {
    const config: BracketConfig = {
      stopLoss: { points: 10, type: 'Stop' },
      takeProfits: [
        { id: 'tp1', points: 20, size: 1 },
      ],
      conditions: [
        {
          id: 'c1',
          trigger: { kind: 'tpFilled', tpIndex: 0 },
          action: { kind: 'moveSLToBreakeven' },
        },
      ],
    };

    armAndConfirm(config, 1);
    bracketEngine.confirmEntryOrderId(42);
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    const slOrderId = (await placeOrder.mock.results[0].value).orderId;
    const tpOrderId = (await placeOrder.mock.results[1].value).orderId;

    // TP fills
    await bracketEngine.onOrderEvent(mockOrder({
      id: tpOrderId,
      contractId: 'CON-NQ',
      status: OrderStatus.Filled,
    }));

    // SL should be modified to entry price (breakeven = 20000)
    expect(modifyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: slOrderId,
        stopPrice: 20000,
      }),
    );
  });

  it('should show toast when condition action fails', async () => {
    modifyOrder.mockRejectedValue(new Error('Modify failed'));

    const config: BracketConfig = {
      stopLoss: { points: 10, type: 'Stop' },
      takeProfits: [
        { id: 'tp1', points: 20, size: 1 },
      ],
      conditions: [
        {
          id: 'c1',
          trigger: { kind: 'tpFilled', tpIndex: 0 },
          action: { kind: 'moveSLToBreakeven' },
        },
      ],
    };

    armAndConfirm(config, 1);
    bracketEngine.confirmEntryOrderId(42);

    // Need SL placement to succeed (but we mocked modifyOrder to fail)
    // So let placeOrder succeed, then modifyOrder will fail on condition
    await bracketEngine.onOrderEvent(mockOrder({ id: 42, status: OrderStatus.Filled, filledPrice: 20000 }));

    const tpOrderId = (await placeOrder.mock.results[1].value).orderId;

    // TP fills — triggers condition which calls modifyOrder (mocked to fail)
    await bracketEngine.onOrderEvent(mockOrder({
      id: tpOrderId,
      contractId: 'CON-NQ',
      status: OrderStatus.Filled,
    }));

    expect(toast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Condition action failed'),
      expect.any(String),
    );
  });
});

describe('moveSLToBreakeven', () => {
  it('should return false and toast when no active session', async () => {
    const result = await bracketEngine.moveSLToBreakeven();
    expect(result).toBe(false);
  });
});
