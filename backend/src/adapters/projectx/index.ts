import type { ExchangeAdapter } from '../types';
import { projectXAuth } from './auth';
import { projectXAccounts } from './accounts';
import { projectXMarketData } from './marketData';
import { projectXOrders } from './orders';
import { projectXTrades } from './trades';
import { projectXRealtime } from './realtime';

export function createProjectXAdapter(): ExchangeAdapter {
  return {
    name: 'projectx',
    auth: projectXAuth,
    accounts: projectXAccounts,
    marketData: projectXMarketData,
    orders: projectXOrders,
    trades: projectXTrades,
    realtime: projectXRealtime,
  };
}
