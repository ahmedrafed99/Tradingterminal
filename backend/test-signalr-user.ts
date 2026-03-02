/**
 * User Hub SignalR test — live account, orders, positions, trades
 * Usage: npx tsx test-signalr-user.ts [accountId]
 *
 * If no accountId is provided, fetches accounts and uses the first one.
 */

import * as signalR from '@microsoft/signalr';

const PROXY = 'http://localhost:3001';
const RTC_HOST = 'https://rtc.topstepx.com';

async function main() {
  // 1. Get JWT
  const tokenRes = await fetch(`${PROXY}/auth/token`).then(r => r.json());
  if (!tokenRes.success) { console.error('Not connected — call POST /auth/connect first'); process.exit(1); }
  const JWT_TOKEN: string = tokenRes.token;
  console.log('Got JWT (' + JWT_TOKEN.length + ' chars)');

  // 2. Get accountId
  let accountId: number;
  if (process.argv[2]) {
    accountId = Number(process.argv[2]);
  } else {
    console.log('No accountId provided — fetching accounts...');
    const acctRes = await fetch(`${PROXY}/accounts`).then(r => r.json());
    if (!acctRes.success || !acctRes.accounts?.length) {
      console.error('No accounts found:', acctRes);
      process.exit(1);
    }
    // Show all accounts so the user can pick
    for (const a of acctRes.accounts) {
      console.log(`  [${a.id}] ${a.name} — balance: ${a.balance ?? '?'}`);
    }
    accountId = acctRes.accounts[0].id;
  }
  console.log(`Using accountId: ${accountId}\n`);

  // 3. Connect to User Hub
  const userHubUrl = `${RTC_HOST}/hubs/user?access_token=${JWT_TOKEN}`;

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(userHubUrl, {
      skipNegotiation: true,
      transport: signalR.HttpTransportType.WebSockets,
      accessTokenFactory: () => JWT_TOKEN,
      timeout: 10000,
    })
    .withAutomaticReconnect()
    .build();

  // 4. Register event handlers BEFORE starting
  connection.on('GatewayUserAccount', (...args: unknown[]) => {
    console.log('[GatewayUserAccount]', JSON.stringify(args, null, 2).slice(0, 500));
  });

  connection.on('GatewayUserOrder', (...args: unknown[]) => {
    console.log('[GatewayUserOrder]', JSON.stringify(args, null, 2).slice(0, 500));
  });

  connection.on('GatewayUserPosition', (...args: unknown[]) => {
    console.log('[GatewayUserPosition]', JSON.stringify(args, null, 2).slice(0, 500));
  });

  connection.on('GatewayUserTrade', (...args: unknown[]) => {
    console.log('[GatewayUserTrade]', JSON.stringify(args, null, 2).slice(0, 500));
  });

  connection.onreconnected(() => {
    console.log('Reconnected — resubscribing');
    subscribe();
  });

  connection.onclose((err) => {
    console.log('Connection closed.', err ? `Error: ${err.message}` : '(clean)');
  });

  // 5. Start & subscribe
  const subscribe = () => {
    connection.invoke('SubscribeAccounts').catch(e => console.error('SubscribeAccounts failed:', e));
    connection.invoke('SubscribeOrders', accountId).catch(e => console.error('SubscribeOrders failed:', e));
    connection.invoke('SubscribePositions', accountId).catch(e => console.error('SubscribePositions failed:', e));
    connection.invoke('SubscribeTrades', accountId).catch(e => console.error('SubscribeTrades failed:', e));
    console.log(`Subscribed to accounts, orders, positions, trades for account ${accountId}`);
  };

  try {
    await connection.start();
    console.log('Connected to User Hub!');
    subscribe();
  } catch (err) {
    console.error('Error starting connection:', err);
    process.exit(1);
  }

  // 6. Run for 60s (user events are less frequent than market quotes)
  setTimeout(() => {
    console.log('\n--- 60s timeout ---');
    connection.stop().then(() => process.exit(0));
  }, 60_000);
}

main();
