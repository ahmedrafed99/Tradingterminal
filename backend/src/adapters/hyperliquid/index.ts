import type { ExchangeAdapter } from '../types';
import type { HlState } from './client';
import { createClient } from './client';
import { createAuth } from './auth';
import { createAccounts } from './accounts';
import { createMarketData, clearMetaCache } from './marketData';
import { createOrders } from './orders';
import { createPositions } from './positions';
import { createTrades } from './trades';
import { createRealtime } from './realtime';

export function createHyperliquidAdapter(): ExchangeAdapter {
  // All mutable state lives here — isolated to this adapter instance
  const state: HlState = {
    privateKey: null,
    walletAddress: null,
    connected: false,
    isTestnet: false,
    apiUrl: 'https://api.hyperliquid.xyz',
  };

  const client = createClient(state);
  const auth = createAuth(state);

  // Wrap disconnect to also clear the meta cache
  const baseDisconnect = auth.disconnect.bind(auth);
  const wrappedAuth = {
    ...auth,
    disconnect() {
      baseDisconnect();
      clearMetaCache();
    },
  };

  return {
    name: 'hyperliquid',
    auth: wrappedAuth,
    accounts: createAccounts(client, state),
    marketData: createMarketData(client),
    orders: createOrders(client, state),
    positions: createPositions(client),
    trades: createTrades(client),
    realtime: createRealtime(state),
  };
}
