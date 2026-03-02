/**
 * Quick SignalR test — matches TopstepX docs exactly
 * Usage: npx tsx test-signalr.ts <contractId>
 */

import * as signalR from '@microsoft/signalr';

const CONTRACT_ID = process.argv[2];
if (!CONTRACT_ID) {
  console.error('Usage: npx tsx test-signalr.ts <contractId>');
  process.exit(1);
}

const PROXY = 'http://localhost:3001';
const RTC_HOST = 'https://rtc.topstepx.com';

async function main() {
  const tokenRes = await fetch(`${PROXY}/auth/token`).then(r => r.json());
  if (!tokenRes.success) { console.error('Not connected'); process.exit(1); }
  const JWT_TOKEN: string = tokenRes.token;
  console.log('Got JWT (' + JWT_TOKEN.length + ' chars)');

  // Exactly as the docs show
  const marketHubUrl = `${RTC_HOST}/hubs/market?access_token=${JWT_TOKEN}`;

  const rtcConnection = new signalR.HubConnectionBuilder()
    .withUrl(marketHubUrl, {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
      accessTokenFactory: () => JWT_TOKEN,
      timeout: 10000,
    })
    .withAutomaticReconnect()
    .build();

  rtcConnection.start()
    .then(() => {
      console.log('Connected!');

      const subscribe = () => {
        rtcConnection.invoke('SubscribeContractQuotes', CONTRACT_ID);
        rtcConnection.invoke('SubscribeContractTrades', CONTRACT_ID);
        rtcConnection.invoke('SubscribeContractMarketDepth', CONTRACT_ID);
        console.log(`Subscribed to quotes/trades/depth for ${CONTRACT_ID}`);
      };

      // Two-param handlers as per docs: (contractId, data)
      rtcConnection.on('GatewayQuote', (contractId: unknown, data: unknown) => {
        console.log('[GatewayQuote]', contractId, JSON.stringify(data).slice(0, 300));
      });

      rtcConnection.on('GatewayTrade', (contractId: unknown, data: unknown) => {
        console.log('[GatewayTrade]', contractId, JSON.stringify(data).slice(0, 300));
      });

      rtcConnection.on('GatewayDepth', (contractId: unknown, data: unknown) => {
        console.log('[GatewayDepth]', contractId, JSON.stringify(data).slice(0, 300));
      });

      subscribe();

      rtcConnection.onreconnected(() => {
        console.log('Reconnected — resubscribing');
        subscribe();
      });

      rtcConnection.onclose((err) => {
        console.log('Connection closed.', err ? `Error: ${err.message}` : '(clean)');
      });

      // Stop after 30s
      setTimeout(() => {
        console.log('\n--- 30s timeout ---');
        rtcConnection.stop().then(() => process.exit(0));
      }, 30_000);
    })
    .catch((err) => {
      console.error('Error starting connection:', err);
      process.exit(1);
    });
}

main();
