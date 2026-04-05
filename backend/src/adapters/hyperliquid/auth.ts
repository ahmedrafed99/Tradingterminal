import { privateKeyToAccount } from 'viem/accounts';
import type { ExchangeAuth, ConnectParams } from '../types';
import type { HlState } from './client';

const MAINNET_URL = 'https://api.hyperliquid.xyz';
const TESTNET_URL = 'https://api.hyperliquid-testnet.xyz';

export function createAuth(state: HlState): ExchangeAuth {
  return {
    async connect({ credentials }: ConnectParams) {
      const privateKey = credentials['privateKey'];
      if (!privateKey) {
        throw new Error('Hyperliquid requires a "privateKey" credential (0x-prefixed hex).');
      }

      const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;

      let account: { address: `0x${string}` };
      try {
        account = privateKeyToAccount(key);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        throw new Error(`Hyperliquid: invalid private key — ${msg}`);
      }

      // Testnet if explicitly opted in via credential, otherwise mainnet
      const isTestnet = credentials['isTestnet'] === 'true';

      state.privateKey = key;
      state.walletAddress = account.address;
      state.connected = true;
      state.isTestnet = isTestnet;
      state.apiUrl = isTestnet ? TESTNET_URL : MAINNET_URL;

      console.log(`[HL auth] ✓ connected — wallet: ${account.address} (${isTestnet ? 'testnet' : 'mainnet'})`);
    },

    disconnect() {
      state.privateKey = null;
      state.walletAddress = null;
      state.connected = false;
      console.log('[HL auth] disconnected');
    },

    isConnected() {
      return state.connected && state.privateKey !== null;
    },

    getStatus() {
      return {
        connected: state.connected,
        walletAddress: state.walletAddress,
        isTestnet: state.isTestnet,
        apiUrl: state.apiUrl,
      };
    },
  };
}
