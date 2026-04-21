/**
 * GatewayTrade inspector — streams live fills and tracks price range
 * Usage: npx tsx test-signalr-trades.ts <contractId>
 */

import * as signalR from '@microsoft/signalr';

const CONTRACT_ID = process.argv[2];
if (!CONTRACT_ID) {
  console.error('Usage: npx tsx test-signalr-trades.ts <contractId>');
  process.exit(1);
}

const PROXY = 'http://localhost:3001';

async function main() {
  const status = await fetch(`${PROXY}/auth/status`).then(r => r.json());
  if (!status.connected) {
    console.error('Backend not connected — call POST /auth/connect first');
    process.exit(1);
  }
  console.log('Backend connected ✓');
  console.log(`Subscribing to trades for contract: ${CONTRACT_ID}\n`);

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${PROXY}/hubs/market`, {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect()
    .build();

  let tradeCount = 0;
  let priceHigh = -Infinity;
  let priceLow = Infinity;

  connection.on('GatewayTrade', (contractId: unknown, data: unknown) => {
    tradeCount++;

    // Full raw payload on first trade so we know the shape
    if (tradeCount === 1) {
      console.log('[GatewayTrade] First payload (full):');
      console.log(JSON.stringify(data, null, 2));
      console.log('---');
    }

    const d = data as Record<string, unknown>;
    const price = typeof d['price'] === 'number' ? d['price']
      : typeof d['Price'] === 'number' ? d['Price']
      : NaN;

    if (!isNaN(price)) {
      if (price > priceHigh) priceHigh = price;
      if (price < priceLow) priceLow = price;
    }

    const range = priceHigh !== -Infinity
      ? `range ${priceLow} – ${priceHigh} (spread: ${(priceHigh - priceLow).toFixed(2)})`
      : 'range: no price field found yet';

    console.log(`[#${tradeCount}] price=${price}  size=${d['size'] ?? d['Size'] ?? d['volume'] ?? d['Volume'] ?? '?'}  ${range}`);
  });

  connection.onreconnected(() => {
    console.log('Reconnected — resubscribing');
    connection.invoke('SubscribeContractTrades', CONTRACT_ID);
  });

  connection.onclose((err) => {
    console.log('Connection closed.', err ? `Error: ${err.message}` : '(clean)');
  });

  await connection.start();
  console.log('Connected ✓');
  await connection.invoke('SubscribeContractTrades', CONTRACT_ID);
  console.log('Subscribed. Waiting for fills...\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
