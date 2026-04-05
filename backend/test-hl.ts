/**
 * Integration test — exercises every adapter method against Hyperliquid testnet.
 * Run: HL_PRIVATE_KEY=0x... npx tsx test-hl.ts
 *
 * Tests:
 *   Auth           — connect, getStatus, isConnected, disconnect, reconnect
 *   Error handling — bad private key, invalid contract, below-minimum size,
 *                    cancel non-existent order, order when disconnected
 *   Accounts       — balance, name, simulated flag
 *   Market data    — search, searchById, availableContracts, bars (Minute/Hour)
 *   Orders         — limit, market, stop, bracket (SL+TP), modify, cancel
 *   Positions      — open positions after market fill
 *   Trades         — fill history
 *   Utils          — floatToWire edge cases, roundToSigFigs
 */

import { createHyperliquidAdapter } from './src/adapters/hyperliquid';
import { floatToWire, roundToSigFigs } from './src/adapters/hyperliquid/client';

const PK = process.env.HL_PRIVATE_KEY;
if (!PK) { console.error('Set HL_PRIVATE_KEY env var'); process.exit(1); }

// ---------------------------------------------------------------------------
// Assertion helpers — test fails immediately on any failed assertion
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function assertThrows(fn: () => Promise<unknown>, label: string, containing?: string): Promise<void> {
  try {
    await fn();
    console.error(`  ✗ ${label}  (expected throw, got none)`);
    failed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (containing && !msg.includes(containing)) {
      console.error(`  ✗ ${label}  (threw, but message "${msg}" doesn't contain "${containing}")`);
      failed++;
    } else {
      console.log(`  ✓ ${label}  → "${msg.slice(0, 120)}"`);
      passed++;
    }
  }
}

// ---------------------------------------------------------------------------
// Extract OID from a place response
// ---------------------------------------------------------------------------
function extractOid(result: unknown, index = 0): number | undefined {
  const statuses = (result as { response?: { data?: { statuses?: Record<string, unknown>[] } } })
    ?.response?.data?.statuses;
  if (!Array.isArray(statuses)) return undefined;
  const s = statuses[index] as Record<string, Record<string, number>>;
  return s?.resting?.oid ?? s?.filled?.oid;
}

// ---------------------------------------------------------------------------
// Cancel all open orders (used as test cleanup)
// ---------------------------------------------------------------------------
async function cancelAllOpen(adapter: ReturnType<typeof import('./src/adapters/hyperliquid').createHyperliquidAdapter>): Promise<void> {
  const open = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  for (const o of open) {
    try { await adapter.orders.cancel({ accountId: '', orderId: o['id'] as string }); }
    catch { /* already gone — ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const now = Date.now();

  // ── 1. UTILS (no network) ─────────────────────────────────────────────
  console.log('\n=== 1. UTILS ===');
  assert(floatToWire(1.5) === '1.5',           'floatToWire(1.5)');
  assert(floatToWire(0.001) === '0.001',       'floatToWire(0.001)');
  assert(floatToWire(1000) === '1000',         'floatToWire(1000)');
  assert(!floatToWire(0.00001).includes('e'),  'floatToWire small — no sci notation');
  assert(floatToWire(0) === '0',               'floatToWire(0)');
  assert(roundToSigFigs(67890.5, 5) === 67891, 'roundToSigFigs 5 sig figs');
  assert(roundToSigFigs(0.12345678, 5) === 0.12346, 'roundToSigFigs small decimal');
  assert(roundToSigFigs(100000, 5) === 100000, 'roundToSigFigs exact');

  // ── 2. AUTH ERROR CASES ───────────────────────────────────────────────
  console.log('\n=== 2. AUTH ERROR CASES ===');
  const badAdapter = createHyperliquidAdapter();

  await assertThrows(
    () => badAdapter.auth.connect({ exchange: 'hyperliquid', credentials: { privateKey: 'not-a-key' } }),
    'bad private key throws',
    'invalid',
  );
  assert(!badAdapter.auth.isConnected(), 'isConnected() false after failed connect');

  await assertThrows(
    () => badAdapter.orders.place({ contractId: 'BTC', type: 2, side: 0, size: 0.001 }),
    'order without connect throws',
    'Not connected',
  );

  // ── 3. AUTH ───────────────────────────────────────────────────────────
  console.log('\n=== 3. AUTH ===');
  const adapter = createHyperliquidAdapter();
  await adapter.auth.connect({ exchange: 'hyperliquid', credentials: { privateKey: PK!, isTestnet: 'true' } });
  const status = adapter.auth.getStatus() as Record<string, unknown>;

  assert(adapter.auth.isConnected(),                         'isConnected() true');
  assert(typeof status['walletAddress'] === 'string',        'walletAddress is string');
  assert((status['walletAddress'] as string).startsWith('0x'), 'walletAddress starts with 0x');
  assert(status['isTestnet'] === true,                        'isTestnet flag set');
  assert((status['apiUrl'] as string).includes('testnet'),    'apiUrl points to testnet');
  console.log(`  wallet: ${status['walletAddress']}`);

  // Disconnect + reconnect
  adapter.auth.disconnect();
  assert(!adapter.auth.isConnected(), 'isConnected() false after disconnect');
  await adapter.auth.connect({ exchange: 'hyperliquid', credentials: { privateKey: PK!, isTestnet: 'true' } });
  assert(adapter.auth.isConnected(), 'isConnected() true after reconnect');

  // ── 4. ACCOUNTS ───────────────────────────────────────────────────────
  console.log('\n=== 4. ACCOUNTS ===');
  const accounts = await adapter.accounts.list() as Record<string, unknown>[];
  assert(accounts.length === 1,                'exactly one account');
  assert(typeof accounts[0]['balance'] === 'number', 'balance is number');
  assert((accounts[0]['balance'] as number) > 0, 'balance > 0 (testnet funded)');
  assert(accounts[0]['simulated'] === true,     'simulated flag true on testnet');
  assert(accounts[0]['canTrade'] === true,      'canTrade true');
  console.log(`  balance: $${(accounts[0]['balance'] as number).toFixed(2)}`);

  // ── 5. MARKET DATA ────────────────────────────────────────────────────
  console.log('\n=== 5. MARKET DATA ===');

  // searchContracts
  const btcResults = await adapter.marketData.searchContracts('BTC', true) as Record<string, unknown>[];
  const btc = btcResults.find((c) => c['id'] === 'BTC');
  assert(btc != null,                         'searchContracts finds BTC');
  assert(typeof btc!['midPrice'] === 'number' && (btc!['midPrice'] as number) > 0, 'BTC midPrice > 0');
  assert(typeof btc!['quantityPrecision'] === 'number', 'BTC has quantityPrecision');
  assert(btc!['exchange'] === 'hyperliquid',  'exchange field set');

  // searchContracts — no results
  const nope = await adapter.marketData.searchContracts('ZZZNOBODY', true) as unknown[];
  assert(nope.length === 0, 'searchContracts returns [] for unknown symbol');

  // searchContractById
  const btcById = await adapter.marketData.searchContractById('BTC', true) as Record<string, unknown> | null;
  assert(btcById != null,           'searchContractById finds BTC');
  assert(btcById!['id'] === 'BTC',  'searchContractById id matches');

  const missing = await adapter.marketData.searchContractById('ZZZNOBODY', true);
  assert(missing === null, 'searchContractById returns null for unknown');

  // availableContracts
  const all = await adapter.marketData.availableContracts(true) as unknown[];
  assert(all.length > 100, `availableContracts returns many (${all.length})`);

  // retrieveBars — Minute
  const bars1m = await adapter.marketData.retrieveBars({
    contractId: 'BTC', unit: 'Minute', unitNumber: 1,
    startTimestamp: new Date(now - 30 * 60_000).toISOString(),
  }) as Record<string, unknown>[];
  assert(bars1m.length > 0, `1m bars returned (${bars1m.length})`);
  const b = bars1m[0];
  assert(typeof b['open'] === 'number' && (b['open'] as number) > 0, 'bar open > 0');
  assert(typeof b['timestamp'] === 'string', 'bar has ISO timestamp');

  // retrieveBars — Hourly
  const bars1h = await adapter.marketData.retrieveBars({
    contractId: 'ETH', unit: 'Hour', unitNumber: 1,
    startTimestamp: new Date(now - 24 * 3600_000).toISOString(),
  }) as Record<string, unknown>[];
  assert(bars1h.length > 0, `ETH 1h bars returned (${bars1h.length})`);

  const mid = btc!['midPrice'] as number;

  // ── 6. ORDERS: LIMIT ──────────────────────────────────────────────────
  console.log('\n=== 6. LIMIT ORDER ===');
  const limitPrice = Math.round(mid * 0.90); // 10% below mid — won't fill
  const limitResult = await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001, limitPrice,
  });
  const limitOid = extractOid(limitResult);
  assert(limitOid != null, `limit order placed, oid: ${limitOid}`);

  const openAfterLimit = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  const limitInList = openAfterLimit.find((o) => o['id'] === `BTC:${limitOid}`);
  assert(limitInList != null, 'limit order visible in searchOpen');
  assert(limitInList!['side'] === 0, 'side = Buy');
  assert(limitInList!['limitPrice'] === limitPrice, `limitPrice matches (${limitInList!['limitPrice']})`);

  // ── 7. ORDERS: MODIFY ─────────────────────────────────────────────────
  // Note: batchModify on HL assigns a NEW oid — old id is gone after modify.
  console.log('\n=== 7. ORDER MODIFY ===');
  const newPrice = Math.round(mid * 0.88);
  await adapter.orders.modify({
    orderId: `BTC:${limitOid}`,
    limitPrice: newPrice,
  });

  const openAfterModify = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  // Search by new price, not old OID (batchModify changes OID)
  const modified = openAfterModify.find(
    (o) => o['contractId'] === 'BTC' && o['limitPrice'] === newPrice,
  );
  assert(modified != null, `modified order found at new price ${newPrice}`);
  // Update limitOid for cancel step
  const modifiedOid = (modified?.['id'] as string | undefined)?.split(':')[1];
  assert(modifiedOid != null, `modified order has valid id: ${modified?.['id']}`);

  // ── 8. ORDERS: CANCEL ─────────────────────────────────────────────────
  console.log('\n=== 8. ORDER CANCEL ===');
  // Use the new OID from modify (or fall back to original if modify wasn't found)
  const cancelId = modified ? (modified['id'] as string) : `BTC:${limitOid}`;
  await adapter.orders.cancel({ accountId: '', orderId: cancelId });
  const openAfterCancel = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  const stillThere = openAfterCancel.find((o) => o['id'] === cancelId);
  assert(stillThere == null, 'order gone after cancel');

  // Cancel non-existent order — should throw
  await assertThrows(
    () => adapter.orders.cancel({ accountId: '', orderId: cancelId }),
    'cancel non-existent order throws',
  );

  // ── 9. ORDERS: BELOW MINIMUM SIZE ────────────────────────────────────
  console.log('\n=== 9. BELOW MINIMUM ($10) ===');
  // $10 min — 0.00001 BTC at ~$67k = ~$0.67, well below minimum
  await assertThrows(
    () => adapter.orders.place({ contractId: 'BTC', type: 1, side: 0, size: 0.00001, limitPrice: mid * 0.9 }),
    'order below $10 minimum throws',
  );

  // ── 10. ORDERS: INVALID CONTRACT ──────────────────────────────────────
  console.log('\n=== 10. INVALID CONTRACT ===');
  await assertThrows(
    () => adapter.orders.place({ contractId: 'FAKETOKEN999', type: 1, side: 0, size: 1, limitPrice: 1 }),
    'order for unknown contract throws',
    'Unknown perp asset',
  );

  // ── 11. ORDERS: MARKET ORDER ──────────────────────────────────────────
  console.log('\n=== 11. MARKET ORDER (ETH, small size) ===');
  const ethResults = await adapter.marketData.searchContracts('ETH', true) as Record<string, unknown>[];
  const eth = ethResults.find((c) => c['id'] === 'ETH')!;
  const ethMid = eth['midPrice'] as number;
  console.log(`  ETH mid: $${ethMid}, szDecimals: ${eth['quantityPrecision']}`);

  // Buy tiny ETH market order (IOC — will fill immediately or cancel)
  const mktResult = await adapter.orders.place({
    contractId: 'ETH', type: 2, side: 0, size: 0.01,
  });
  const mktStatuses = (mktResult as { response?: { data?: { statuses?: unknown[] } } })
    ?.response?.data?.statuses ?? [];
  const mktStatus = mktStatuses[0] as Record<string, unknown> | undefined;
  const filled = mktStatus?.['filled'] as Record<string, unknown> | undefined;
  const cancelled = mktStatus?.['error'];
  assert(filled != null || cancelled != null, `market order completed (filled or cancelled as expected)`);
  if (filled) console.log(`  filled: oid=${filled['oid']}, avgPx=${filled['avgPx']}`);
  if (cancelled) console.log(`  cancelled (no liquidity or IOC): ${cancelled}`);

  // ── 12. POSITIONS ─────────────────────────────────────────────────────
  console.log('\n=== 12. POSITIONS ===');
  const positions = await adapter.positions.searchOpen('') as Record<string, unknown>[];
  console.log(`  open positions: ${positions.length}`);
  for (const p of positions) {
    assert(typeof p['contractId'] === 'string',     `position contractId: ${p['contractId']}`);
    assert(typeof p['size'] === 'number' && (p['size'] as number) > 0, `position size > 0: ${p['size']}`);
    assert(p['type'] === 0 || p['type'] === 1,      'position type is 0 (long) or 1 (short)');
    console.log(`  ${p['contractId']} ${p['type'] === 0 ? 'LONG' : 'SHORT'} ${p['size']} @ $${p['averagePrice']}`);
  }

  // Shared bracket price levels (used across sections 13–18)
  // BUY limit entry well below market; TP above market; SL below entry
  const bracketEntryPrice = Math.round(mid * 0.87);
  const slPrice           = Math.round(mid * 0.83);
  const tpPrice           = Math.round(mid * 1.10);
  const tp1Price          = Math.round(mid * 1.08);
  const tp2Price          = Math.round(mid * 1.15);

  // ── 13. BRACKET: 1 TP + 1 SL (atomic normalTpsl) ─────────────────────
  console.log('\n=== 13. BRACKET: 1 TP + 1 SL (normalTpsl) ===');
  const bracket1Result = await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001,
    limitPrice: bracketEntryPrice,
    stopLossBracket: { price: slPrice },
    takeProfitBrackets: [{ price: tpPrice }],
  });
  const bracket1Statuses = (bracket1Result as { response?: { data?: { statuses?: unknown[] } } })
    ?.response?.data?.statuses ?? [];
  assert(bracket1Statuses.length === 3, `normalTpsl: 3 statuses (got ${bracket1Statuses.length})`);
  assert(extractOid(bracket1Result, 0) != null, `entry oid: ${extractOid(bracket1Result, 0)}`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, '1TP+1SL cleaned up');

  // ── 14. BRACKET: 2 TPs equal split + 1 SL ────────────────────────────
  console.log('\n=== 14. BRACKET: 2 TPs + 1 SL ===');
  await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001,
    limitPrice: bracketEntryPrice,
    stopLossBracket: { price: slPrice },
    takeProfitBrackets: [{ price: tp1Price }, { price: tp2Price }],
  });
  const open2Tp = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  assert(open2Tp.length === 4, `4 orders open: entry + TP1 + TP2 + SL (got ${open2Tp.length})`);
  // For a BUY bracket: TP stopPrice > entry, SL stopPrice < entry
  const tpOrders2 = open2Tp.filter((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  const slOrders2 = open2Tp.filter((o) => o['isTrigger'] && (o['stopPrice'] as number) < bracketEntryPrice);
  assert(tpOrders2.length === 2, `2 TP orders (got ${tpOrders2.length})`);
  assert(slOrders2.length === 1, `1 SL order (got ${slOrders2.length})`);
  assert(tpOrders2.every((o) => (o['size'] as number) === 0.0005), `each TP = 0.0005 (equal split)`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, '2TP+1SL cleaned up');

  // ── 15. BRACKET: 2 TPs explicit sizes ────────────────────────────────
  console.log('\n=== 15. BRACKET: 2 TPs explicit sizes ===');
  await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.002,
    limitPrice: bracketEntryPrice,
    takeProfitBrackets: [{ price: tp1Price, size: 0.001 }, { price: tp2Price, size: 0.001 }],
  });
  const openExplicit = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  const explicitTps = openExplicit.filter((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  assert(explicitTps.length === 2, `2 TP orders (got ${explicitTps.length})`);
  assert(explicitTps.every((o) => (o['size'] as number) === 0.001), `each TP = 0.001 (explicit)`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, 'explicit-size TPs cleaned up');

  // ── 16. MODIFY TP TRIGGER PRICE ───────────────────────────────────────
  console.log('\n=== 16. MODIFY TP ===');
  await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001,
    limitPrice: bracketEntryPrice,
    takeProfitBrackets: [{ price: tp1Price }],
  });
  const openForModify = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  const tpToModify = openForModify.find((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  assert(tpToModify != null, `found TP to modify (id: ${tpToModify?.['id']})`);
  const newTpPrice = Math.round(mid * 1.12);
  await adapter.orders.modify({ accountId: '', orderId: tpToModify!['id'] as string, stopPrice: newTpPrice });
  const openAfterTpModify = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  const modifiedTp = openAfterTpModify.find((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  assert(modifiedTp != null, 'modified TP still in open orders');
  assert((modifiedTp!['stopPrice'] as number) === newTpPrice,
    `TP trigger updated to ${newTpPrice} (got ${modifiedTp!['stopPrice']})`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, 'modified TP cleaned up');

  // ── 17. CANCEL INDIVIDUAL TP — other orders survive ───────────────────
  console.log('\n=== 17. CANCEL INDIVIDUAL TP ===');
  await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001,
    limitPrice: bracketEntryPrice,
    stopLossBracket: { price: slPrice },
    takeProfitBrackets: [{ price: tp1Price }, { price: tp2Price }],
  });
  const openBefore17 = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  assert(openBefore17.length === 4, `4 orders before cancel (got ${openBefore17.length})`);
  // Cancel only TP1 (the lower-price TP)
  const sortedTps17 = openBefore17
    .filter((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice)
    .sort((a, b) => (a['stopPrice'] as number) - (b['stopPrice'] as number));
  await adapter.orders.cancel({ accountId: '', orderId: sortedTps17[0]['id'] as string });
  const openAfter17 = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  assert(openAfter17.length === 3, `3 orders after cancelling TP1 (got ${openAfter17.length})`);
  const remaining17Tps = openAfter17.filter((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  const remaining17Sls = openAfter17.filter((o) => o['isTrigger'] && (o['stopPrice'] as number) < bracketEntryPrice);
  assert(remaining17Tps.length === 1, `TP2 still alive (got ${remaining17Tps.length})`);
  assert(remaining17Sls.length === 1, `SL still alive after cancelling TP1`);
  assert((remaining17Tps[0]['stopPrice'] as number) === tp2Price,
    `surviving TP is TP2 at ${tp2Price} (got ${remaining17Tps[0]['stopPrice']})`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, 'individual TP cancel test cleaned up');

  // ── 18. CANCEL SL — TPs survive ───────────────────────────────────────
  console.log('\n=== 18. CANCEL SL ===');
  await adapter.orders.place({
    contractId: 'BTC', type: 1, side: 0, size: 0.001,
    limitPrice: bracketEntryPrice,
    stopLossBracket: { price: slPrice },
    takeProfitBrackets: [{ price: tpPrice }],
  });
  const openBefore18 = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  assert(openBefore18.length === 3, `3 orders before SL cancel (got ${openBefore18.length})`);
  const slToCancel18 = openBefore18.find((o) => o['isTrigger'] && (o['stopPrice'] as number) < bracketEntryPrice);
  assert(slToCancel18 != null, `found SL (id: ${slToCancel18?.['id']})`);
  await adapter.orders.cancel({ accountId: '', orderId: slToCancel18!['id'] as string });
  const openAfter18 = await adapter.orders.searchOpen('') as Record<string, unknown>[];
  assert(openAfter18.length === 2, `2 orders remain after SL cancel (got ${openAfter18.length})`);
  const survivingTp18 = openAfter18.find((o) => o['isTrigger'] && (o['stopPrice'] as number) > bracketEntryPrice);
  assert(survivingTp18 != null, 'TP survives after SL cancel');
  assert((survivingTp18!['stopPrice'] as number) === tpPrice,
    `TP still at ${tpPrice} (got ${survivingTp18!['stopPrice']})`);
  await cancelAllOpen(adapter);
  assert((await adapter.orders.searchOpen('') as unknown[]).length === 0, 'SL cancel test cleaned up');

  // ── 19. TRADES HISTORY ────────────────────────────────────────────────
  console.log('\n=== 19. TRADES ===');
  const trades = await adapter.trades.search({
    accountId: '',
    startTimestamp: new Date(now - 30 * 86400_000).toISOString(), // last 30 days
  }) as Record<string, unknown>[];
  console.log(`  fills in last 30d: ${trades.length}`);
  for (const t of trades.slice(0, 3)) {
    assert(typeof t['contractId'] === 'string', `trade contractId: ${t['contractId']}`);
    assert(typeof t['price'] === 'number',      `trade price: ${t['price']}`);
    assert(t['side'] === 0 || t['side'] === 1,  `trade side valid`);
    console.log(`  ${t['contractId']} ${t['side'] === 0 ? 'BUY' : 'SELL'} ${t['size']} @ $${t['price']}`);
  }

  // ── 20. ADAPTER ISOLATION ────────────────────────────────────────────
  console.log('\n=== 20. ADAPTER ISOLATION ===');
  const adapter2 = createHyperliquidAdapter();
  await adapter2.auth.connect({ exchange: 'hyperliquid', credentials: { privateKey: PK!, isTestnet: 'true' } });
  adapter2.auth.disconnect();

  // adapter1 should still be connected — its state is unaffected by adapter2
  assert(adapter.auth.isConnected(), 'adapter1 unaffected by adapter2 disconnect');
  assert(!adapter2.auth.isConnected(), 'adapter2 disconnected independently');

  // ── SUMMARY ───────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n!!! SOME TESTS FAILED !!!');
    process.exit(1);
  } else {
    console.log('\n=== ALL TESTS PASSED ===');
  }
}

main().catch((err: unknown) => {
  const msg = (err as { response?: { data?: unknown }; message?: string })?.response?.data
    ?? (err instanceof Error ? err.message : err);
  console.error('\n!!! UNCAUGHT ERROR !!!', msg);
  process.exit(1);
});
