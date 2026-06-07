import type { ExchangeAdapter } from '../types';
import { createProjectXAuth } from './auth';
import { createProjectXAccounts } from './accounts';
import { createProjectXMarketData } from './marketData';
import { createProjectXOrders } from './orders';
import { createProjectXPositions } from './positions';
import { createProjectXTrades } from './trades';

export function createProjectXAdapter(): ExchangeAdapter {
  const { auth, helpers } = createProjectXAuth();
  return {
    name: 'projectx',
    auth,
    accounts:   createProjectXAccounts(helpers),
    marketData: createProjectXMarketData(helpers),
    orders:     createProjectXOrders(helpers),
    positions:  createProjectXPositions(helpers),
    trades:     createProjectXTrades(helpers),
    // realtime is managed by realtimeService.ts (sole SignalR connection)
  };
}
