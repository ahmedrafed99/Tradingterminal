/**
 * Test script: Verify GatewayDepth events from the SignalR Market Hub.
 *
 * Usage (backend must be running & authenticated):
 *   cd backend
 *   npx tsx scripts/test-gateway-depth.ts <contractId>
 *
 * Example:
 *   npx tsx scripts/test-gateway-depth.ts CON.F.US.ENQ.H26
 *
 * The script connects to the market hub, subscribes to contract depth,
 * and logs every GatewayDepth event for 60 seconds so we can verify
 * the exact data shape — specifically whether it includes session-wide
 * volume-at-price data or just current order book depth.
 */

import * as signalR from '@microsoft/signalr';

const BACKEND_URL = 'http://localhost:3001';
const RTC_HOST = 'https://rtc.topstepx.com';
const LISTEN_SECONDS = 60;

const contractId = process.argv[2];
if (!contractId) {
  console.error('Usage: npx tsx scripts/test-gateway-depth.ts <contractId>');
  console.error('Example: npx tsx scripts/test-gateway-depth.ts CON.F.US.ENQ.H26');
  process.exit(1);
}

interface DepthEntry {
  price: number;
  volume: number;
  currentVolume: number;
  type: number;
  timestamp: string;
}

// Normalize arg[1] — SignalR may send array entries as spread args or as a proper array
function extractEntries(args: unknown[]): { contractId: string; entries: DepthEntry[] } {
  const cid = args[0] as string;
  const rest = args.slice(1);

  // If arg[1] is already an array
  if (rest.length === 1 && Array.isArray(rest[0])) {
    return { contractId: cid, entries: rest[0] as DepthEntry[] };
  }

  // arg[1] might be an array-like object with numeric keys (SignalR quirk)
  if (rest.length === 1 && rest[0] && typeof rest[0] === 'object') {
    const obj = rest[0] as Record<string, unknown>;
    const keys = Object.keys(obj);
    // Check if all keys are numeric
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const arr: DepthEntry[] = [];
      for (let i = 0; i < keys.length; i++) {
        if (obj[String(i)] !== undefined) arr.push(obj[String(i)] as DepthEntry);
      }
      return { contractId: cid, entries: arr };
    }
    // Single entry as object
    return { contractId: cid, entries: [obj as unknown as DepthEntry] };
  }

  // Entries spread as individual args
  return { contractId: cid, entries: rest as DepthEntry[] };
}

async function main() {
  // 1. Get JWT from backend
  console.log('[1] Fetching JWT from backend...');
  const tokenRes = await fetch(`${BACKEND_URL}/auth/token`);
  if (!tokenRes.ok) {
    console.error(`Failed to get token: ${tokenRes.status} ${tokenRes.statusText}`);
    console.error('Make sure the backend is running and you have called POST /auth/connect first.');
    process.exit(1);
  }
  const tokenData = await tokenRes.json() as { success: boolean; token: string };
  if (!tokenData.success || !tokenData.token) {
    console.error('Token response:', tokenData);
    process.exit(1);
  }
  const token = tokenData.token;
  console.log(`[1] Got JWT (${token.length} chars)`);

  // 2. Connect to market hub
  console.log('[2] Connecting to market hub...');
  const hub = new signalR.HubConnectionBuilder()
    .withUrl(`${RTC_HOST}/hubs/market?access_token=${token}`, {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
    })
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  let depthCount = 0;
  const typeCounts: Record<number, number> = {};
  let snapshotEntries: DepthEntry[] = [];
  let biggestEventSize = 0;

  // 3. Listen for GatewayDepth
  hub.on('GatewayDepth', (...args: unknown[]) => {
    depthCount++;
    const { contractId: cid, entries } = extractEntries(args);

    // Filter out null entries (SignalR sometimes includes nulls in the array)
    const valid = entries.filter((e): e is DepthEntry => e != null);

    // Track type distribution
    for (const e of valid) {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    }

    if (valid.length > biggestEventSize) {
      biggestEventSize = valid.length;
    }

    // First event: log full raw shape
    if (depthCount === 1) {
      console.log('\n========== FIRST GatewayDepth EVENT ==========');
      console.log(`Contract: ${cid}`);
      console.log(`Entries: ${valid.length} (${entries.length - valid.length} nulls filtered)`);
      valid.forEach((e, i) => {
        console.log(`  [${i}] price=${e.price} vol=${e.volume} curVol=${e.currentVolume} type=${e.type} ts=${e.timestamp}`);
      });
      console.log('===============================================\n');
    }

    // Detect the big snapshot (initial session dump)
    if (valid.length > 50 && snapshotEntries.length === 0) {
      snapshotEntries = valid;
      console.log(`\n========== SNAPSHOT EVENT (#${depthCount}) — ${valid.length} price levels ==========`);

      // Group by type
      const byType: Record<number, DepthEntry[]> = {};
      for (const e of valid) {
        if (!byType[e.type]) byType[e.type] = [];
        byType[e.type].push(e);
      }

      for (const [type, items] of Object.entries(byType)) {
        const nonZero = items.filter((e) => e.price > 0);
        const prices = nonZero.map((e) => e.price).sort((a, b) => a - b);
        const totalVol = nonZero.reduce((s, e) => s + e.volume, 0);
        const totalCurVol = nonZero.reduce((s, e) => s + e.currentVolume, 0);

        console.log(`\n  TYPE ${type}: ${items.length} entries (${nonZero.length} with price > 0)`);
        if (prices.length > 0) {
          console.log(`    Price range: ${prices[0]} — ${prices[prices.length - 1]}`);
          console.log(`    Total volume: ${totalVol}  |  Total currentVolume: ${totalCurVol}`);
        }

        // Show first 5 and last 5 non-zero entries
        const sample = nonZero.slice(0, 5);
        console.log(`    First entries:`);
        for (const e of sample) {
          console.log(`      price=${e.price}  vol=${e.volume}  curVol=${e.currentVolume}`);
        }
        if (nonZero.length > 5) {
          console.log(`    ...`);
          const tail = nonZero.slice(-5);
          console.log(`    Last entries:`);
          for (const e of tail) {
            console.log(`      price=${e.price}  vol=${e.volume}  curVol=${e.currentVolume}`);
          }
        }
      }

      // Find top 10 by volume
      const sorted = [...valid].filter((e) => e.price > 0).sort((a, b) => b.volume - a.volume);
      if (sorted.length > 0) {
        console.log(`\n  TOP 10 by volume:`);
        sorted.slice(0, 10).forEach((e, i) => {
          console.log(`    ${i + 1}. price=${e.price}  vol=${e.volume}  curVol=${e.currentVolume}  type=${e.type}`);
        });
      }

      console.log(`\n${'='.repeat(70)}\n`);
    } else {
      // Compact log for incremental updates
      const summary = valid
        .map((e) => `p=${e.price} v=${e.volume} cv=${e.currentVolume} t=${e.type}`)
        .join(' | ');
      console.log(`[depth #${depthCount}] ${cid} (${valid.length} entries) ${summary}`);
    }
  });

  // Also listen for GatewayQuote to confirm connection
  let quoteCount = 0;
  hub.on('GatewayQuote', (cid: string, data: Record<string, unknown>) => {
    quoteCount++;
    if (quoteCount === 1) {
      console.log(`[quote] First quote received — connection confirmed. price=${data.lastPrice}`);
    }
  });

  // Catch gatewaylogout
  hub.on('gatewaylogout', (...args: unknown[]) => {
    console.error('\n[!] SERVER SENT gatewaylogout — another session is active!');
    console.error('    Close topstepx.com, the Topstep app, or your frontend before running this.');
    console.error('    Raw args:', JSON.stringify(args));
    hub.stop().then(() => process.exit(1));
  });

  hub.on('GatewayTrade', () => {});

  hub.onclose((err) => {
    if (err) console.error('[!] Hub closed with error:', err.message);
    else console.log('[!] Hub closed.');
  });

  await hub.start();
  console.log(`[2] Connected to market hub (state: ${hub.state})`);

  // 4. Subscribe
  console.log(`[3] Subscribing to quotes + depth for ${contractId}...`);
  await hub.invoke('SubscribeContractQuotes', contractId);
  console.log('    SubscribeContractQuotes OK');

  await hub.invoke('SubscribeContractMarketDepth', contractId);
  console.log('    SubscribeContractMarketDepth OK');

  console.log(`\n[4] Listening for ${LISTEN_SECONDS}s... (depth events will appear below)`);
  console.log('    If no depth events appear, market may be closed.\n');

  // 5. Wait and then report
  await new Promise((resolve) => setTimeout(resolve, LISTEN_SECONDS * 1000));

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Quotes received: ${quoteCount}`);
  console.log(`Depth events received: ${depthCount}`);
  console.log(`Biggest event size: ${biggestEventSize} entries`);
  console.log(`\nType distribution across all events:`);
  for (const [type, count] of Object.entries(typeCounts).sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`  type ${type}: ${count} entries`);
  }
  if (snapshotEntries.length > 0) {
    console.log(`\nSnapshot had ${snapshotEntries.length} price levels — this IS session volume profile data!`);
  } else {
    console.log(`\nNo large snapshot received — only incremental updates.`);
  }
  console.log('=============================\n');

  await hub.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
