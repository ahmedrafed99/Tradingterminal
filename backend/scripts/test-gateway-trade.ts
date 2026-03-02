/**
 * Test script: Verify GatewayTrade events from the SignalR Market Hub.
 *
 * Usage (backend must be running & authenticated):
 *   cd backend
 *   npx tsx scripts/test-gateway-trade.ts <contractId>
 *
 * Example:
 *   npx tsx scripts/test-gateway-trade.ts CON.F.US.ENQ.M26
 *
 * The script connects to the market hub, subscribes to contract trades,
 * and logs every GatewayTrade event for 60 seconds so we can verify
 * the exact data shape.
 */

import * as signalR from '@microsoft/signalr';

const BACKEND_URL = 'http://localhost:3001';
const RTC_HOST = 'https://rtc.topstepx.com';
const LISTEN_SECONDS = 60;

const contractId = process.argv[2];
if (!contractId) {
  console.error('Usage: npx tsx scripts/test-gateway-trade.ts <contractId>');
  console.error('Example: npx tsx scripts/test-gateway-trade.ts CON.F.US.ENQ.M26');
  process.exit(1);
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

  let tradeCount = 0;
  let firstEvent: unknown = null;

  // 3. Listen for GatewayTrade — log ALL arguments to see the exact shape
  hub.on('GatewayTrade', (...args: unknown[]) => {
    tradeCount++;
    if (!firstEvent) {
      firstEvent = args;
      console.log('\n========== FIRST GatewayTrade EVENT (raw args) ==========');
      console.log(`Number of arguments: ${args.length}`);
      args.forEach((arg, i) => {
        console.log(`\n--- arg[${i}] ---`);
        console.log(JSON.stringify(arg, null, 2));
      });
      console.log('=========================================================\n');
    }

    // Compact log for subsequent events
    if (args.length === 2) {
      const [cid, data] = args;
      const d = data as Record<string, unknown>;
      console.log(
        `[trade #${tradeCount}] contract=${cid} price=${d.price} vol=${d.volume ?? d.size ?? d.quantity} ` +
        `type=${d.type} ts=${d.timestamp}`
      );
    } else {
      console.log(`[trade #${tradeCount}]`, JSON.stringify(args));
    }
  });

  // Also listen for GatewayQuote to confirm connection is working
  let quoteCount = 0;
  hub.on('GatewayQuote', (cid: string, data: Record<string, unknown>) => {
    quoteCount++;
    if (quoteCount === 1) {
      console.log(`[quote] First quote received — connection confirmed. price=${data.lastPrice}`);
    }
  });

  // Catch gatewaylogout — TopstepX kicks us if another session exists
  hub.on('gatewaylogout', (...args: unknown[]) => {
    console.error('\n[!] SERVER SENT gatewaylogout — another session is active!');
    console.error('    Close topstepx.com, the Topstep app, or your frontend before running this.');
    console.error('    Raw args:', JSON.stringify(args));
    hub.stop().then(() => process.exit(1));
  });

  // Catch any unknown method names to see what the server sends
  hub.on('GatewayDepth', () => {}); // silence if subscribed

  hub.onclose((err) => {
    if (err) console.error('[!] Hub closed with error:', err.message);
    else console.log('[!] Hub closed.');
  });

  await hub.start();
  console.log(`[2] Connected to market hub (state: ${hub.state})`);

  // 4. Subscribe to both quotes (to confirm connection) and trades
  console.log(`[3] Subscribing to quotes + trades for ${contractId}...`);
  await hub.invoke('SubscribeContractQuotes', contractId);
  console.log('    SubscribeContractQuotes OK');

  await hub.invoke('SubscribeContractTrades', contractId);
  console.log('    SubscribeContractTrades OK');

  console.log(`\n[4] Listening for ${LISTEN_SECONDS}s... (trades will appear below)`);
  console.log('    If no trades appear, market may be closed.\n');

  // 5. Wait and then report
  await new Promise((resolve) => setTimeout(resolve, LISTEN_SECONDS * 1000));

  console.log(`\n========== SUMMARY ==========`);
  console.log(`Quotes received: ${quoteCount}`);
  console.log(`Trades received: ${tradeCount}`);
  if (firstEvent) {
    console.log(`\nFirst event shape (for documentation):`);
    console.log(JSON.stringify(firstEvent, null, 2));
  } else {
    console.log('\nNo trade events received. Market may be closed or contract ID may be wrong.');
  }
  console.log('=============================\n');

  await hub.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
