import type { ExchangeAccounts } from '../types';
import type { HlClient, HlState } from './client';

interface ClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  withdrawable: string;
}

export function createAccounts(client: HlClient, state: HlState): ExchangeAccounts {
  return {
    async list() {
      const wallet = client.getWalletAddress();
      const data = await client.info<ClearinghouseState>({
        type: 'clearinghouseState',
        user: wallet,
      });

      const balance = parseFloat(data.marginSummary.accountValue);

      return {
        success: true,
        accounts: [
          {
            id: wallet,
            name: 'Hyperliquid',
            balance,
            canTrade: state.connected,
            isVisible: true,
            simulated: state.isTestnet,
          },
        ],
      };
    },
  };
}
