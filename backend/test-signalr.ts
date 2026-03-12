/**
 * Quick SignalR market hub test — connects through backend proxy
 * Usage: npx tsx test-signalr.ts <contractId>
 *
 * The backend proxy at localhost:3001 injects the JWT automatically,
 * so no token fetching is needed.
 */

import * as signalR from '@microsoft/signalr';

const CONTRACT_ID = process.argv[2];
if (!CONTRACT_ID) {
  console.error('Usage: npx tsx test-signalr.ts <contractId>');
  process.exit(1);
}

const PROXY = 'http://localhost:3001';

async function main() {
  // Verify backend is connected
  const status = await fetch(`${PROXY}/auth/status`).then(r => r.json());
  if (!status.connected) {
    console.error('Backend not connected — call POST /auth/connect first');
    process.exit(1);
  }
  console.log('Backend connected ✓');

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${PROXY}/hubs/market`, {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
      timeout: 10000,
    })
    .withAutomaticReconnect()
    .build();

  // Register handlers before starting
  let quoteCount = 0;
  let tradeCount = 0;
  let depthCount = 0;

  connection.on('GatewayQuote', (contractId: unknown, data: unknown) => {
    quoteCount++;
    if (quoteCount <= 5) {
      console.log(`[GatewayQuote #${quoteCount}]`, contractId, JSON.stringify(data).slice(0, 300));
    } else if (quoteCount % 50 === 0) {
      console.log(`[GatewayQuote] ${quoteCount} received so far...`);
    }
  });

  connection.on('GatewayTrade', (contractId: unknown, data: unknown) => {
    tradeCount++;
    console.log(`[GatewayTrade #${tradeCount}]`, contractId, JSON.stringify(data).slice(0, 300));
  });

  connection.on('GatewayDepth', (contractId: unknown, data: unknown) => {
    depthCount++;
    if (depthCount <= 3) {
      console.log(`[GatewayDepth #${depthCount}]`, contractId, JSON.stringify(data).slice(0, 500));
    } else if (depthCount % 20 === 0) {
      console.log(`[GatewayDepth] ${depthCount} received so far...`);
    }
  });

  connection.onreconnected(() => {
    console.log('Reconnected — resubscribing');
    subscribe();
  });

  connection.onclose((err) => {
    console.log('Connection closed.', err ? `Error: ${err.message}` : '(clean)');
  });

  const subscribe = () => {
    connection.invoke('SubscribeContractQuotes', CONTRACT_ID);
    connection.invoke('SubscribeContractTrades', CONTRACT_ID);
    connection.invoke('SubscribeContractMarketDepth', CONTRACT_ID);
    console.log(`Subscribed to quotes/trades/depth for contract ${CONTRACT_ID}`);
  };

  try {
    await connection.start();
    console.log('Connected to Market Hub!');
    subscribe();
  } catch (err) {
    console.error('Error starting connection:', err);
    process.exit(1);
  }

  // Run for 30s then print summary
  setTimeout(() => {
    console.log('\n--- 30s timeout ---');
    console.log(`Total: ${quoteCount} quotes, ${tradeCount} trades, ${depthCount} depth updates`);
    connection.stop().then(() => process.exit(0));
  }, 30_000);
}

main();
