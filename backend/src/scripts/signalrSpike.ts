/**
 * SignalR spike — verifies @microsoft/signalr works from Node.js against ProjectX.
 * Run: cd backend && npx tsx src/scripts/signalrSpike.ts
 *
 * Connects to the user hub, listens for GatewayUserOrder / GatewayUserPosition
 * events for 60 seconds, then exits.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import axios from 'axios';
import * as signalR from '@microsoft/signalr';

// ---------------------------------------------------------------------------
// Credential helpers (mirrors credentialRoutes.ts)
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '../../data');
const CREDS_FILE = path.join(DATA_DIR, '.credentials.enc');

function deriveKey(): Buffer {
  const machineId = `${os.hostname()}:${os.homedir()}:trading-terminal`;
  return crypto.scryptSync(machineId, 'trading-terminal-salt', 32);
}

function decrypt(packed: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, dataHex] = packed.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function loadCredentials(): { userName: string; apiKey: string } {
  const raw = fs.readFileSync(CREDS_FILE, 'utf-8');
  return JSON.parse(decrypt(raw));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[spike] Loading credentials...');
  let creds: { userName: string; apiKey: string };
  try {
    creds = loadCredentials();
    console.log(`[spike] Credentials loaded for user: ${creds.userName}`);
  } catch (err) {
    console.error('[spike] Failed to load credentials:', err);
    console.error('[spike] Make sure you have connected once via the trading terminal UI first.');
    process.exit(1);
  }

  // 1. Get JWT token
  console.log('[spike] Authenticating with ProjectX...');
  const BASE_URL = 'https://api.topstepx.com';
  const RTC_URL = 'https://rtc.topstepx.com';

  let token: string;
  try {
    const res = await axios.post(
      `${BASE_URL}/api/Auth/loginKey`,
      { userName: creds.userName, apiKey: creds.apiKey },
      { headers: { 'Content-Type': 'application/json', Accept: 'text/plain' } },
    );
    if (!res.data.success) throw new Error(res.data.errorMessage ?? 'Login failed');
    token = res.data.token as string;
    console.log('[spike] ✓ Authenticated');
  } catch (err) {
    console.error('[spike] Auth failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 2. Connect to user hub via @microsoft/signalr
  console.log(`[spike] Connecting to ${RTC_URL}/hubs/user ...`);

  const connection = new signalR.HubConnectionBuilder()
    .withUrl(`${RTC_URL}/hubs/user`, {
      accessTokenFactory: () => token,
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,  // try direct WS first; remove if it fails
    })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();

  // 3. Register event handlers
  connection.on('GatewayUserOrder', (...args: unknown[]) => {
    console.log('[spike] GatewayUserOrder:', JSON.stringify(args, null, 2));
  });

  connection.on('GatewayUserPosition', (...args: unknown[]) => {
    console.log('[spike] GatewayUserPosition:', JSON.stringify(args, null, 2));
  });

  connection.on('GatewayUserAccount', (...args: unknown[]) => {
    console.log('[spike] GatewayUserAccount:', JSON.stringify(args, null, 2));
  });

  connection.on('GatewayUserTrade', (...args: unknown[]) => {
    console.log('[spike] GatewayUserTrade:', JSON.stringify(args, null, 2));
  });

  connection.onclose((err) => {
    console.log('[spike] Connection closed', err ? `(error: ${err.message})` : '(clean)');
  });

  connection.onreconnecting((err) => {
    console.log('[spike] Reconnecting...', err?.message);
  });

  connection.onreconnected((id) => {
    console.log('[spike] Reconnected, connectionId:', id);
  });

  // 4. Start connection
  try {
    await connection.start();
    console.log('[spike] ✓ Connected! State:', connection.state);
    console.log('[spike] Connection ID:', connection.connectionId);
  } catch (err) {
    console.error('[spike] Connection failed:', err instanceof Error ? err.message : err);
    console.log('\n[spike] Retrying without skipNegotiation...');

    // Retry without skipNegotiation (uses negotiate endpoint first)
    const connection2 = new signalR.HubConnectionBuilder()
      .withUrl(`${RTC_URL}/hubs/user`, {
        accessTokenFactory: () => token,
      })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build();

    connection2.on('GatewayUserOrder', (...args: unknown[]) => {
      console.log('[spike] GatewayUserOrder:', JSON.stringify(args, null, 2));
    });
    connection2.on('GatewayUserPosition', (...args: unknown[]) => {
      console.log('[spike] GatewayUserPosition:', JSON.stringify(args, null, 2));
    });

    try {
      await connection2.start();
      console.log('[spike] ✓ Connected (with negotiation)! State:', connection2.state);

      // Subscribe to orders
      try {
        await connection2.invoke('SubscribeOrders');
        console.log('[spike] ✓ Subscribed to orders');
      } catch (subErr) {
        console.warn('[spike] SubscribeOrders failed (may not be needed):', subErr instanceof Error ? subErr.message : subErr);
      }

      console.log('[spike] Listening for 60 seconds...');
      await new Promise((r) => setTimeout(r, 60_000));
      await connection2.stop();
    } catch (err2) {
      console.error('[spike] Both connection attempts failed:', err2 instanceof Error ? err2.message : err2);
      process.exit(1);
    }
    return;
  }

  // 5. Subscribe to order events
  try {
    await connection.invoke('SubscribeOrders');
    console.log('[spike] ✓ Subscribed to orders');
  } catch (subErr) {
    console.warn('[spike] SubscribeOrders invocation failed (may not be needed):', subErr instanceof Error ? subErr.message : subErr);
  }

  console.log('[spike] Listening for 60 seconds... (place/cancel an order to see events)');
  await new Promise((r) => setTimeout(r, 60_000));

  await connection.stop();
  console.log('[spike] Done.');
}

main().catch((err) => {
  console.error('[spike] Unhandled error:', err);
  process.exit(1);
});