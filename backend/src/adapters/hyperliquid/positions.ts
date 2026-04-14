import type { ExchangePositions } from '../types';
import type { HlClient } from './client';

interface HlAssetPosition {
  position: {
    coin: string;
    szi: string;      // positive = long, negative = short
    entryPx: string | null;
    positionValue: string;
    unrealizedPnl: string;
    liquidationPx: string | null;
    marginUsed: string;
  };
  type: string;
}

interface HlClearinghouseState {
  assetPositions: HlAssetPosition[];
}

export function createPositions(client: HlClient): ExchangePositions {
  return {
    async searchOpen(_accountId) {
      const wallet = client.getWalletAddress();
      const data = await client.info<HlClearinghouseState>({
        type: 'clearinghouseState',
        user: wallet,
      });

      const positions = data.assetPositions
        .filter((ap) => parseFloat(ap.position.szi) !== 0)
        .map((ap) => {
          const szi = parseFloat(ap.position.szi);
          return {
            id: ap.position.coin,
            accountId: wallet,
            contractId: ap.position.coin,
            type: szi > 0 ? 0 : 1,   // 0 = long, 1 = short
            size: Math.abs(szi),
            averagePrice: ap.position.entryPx != null ? parseFloat(ap.position.entryPx) : 0,
            unrealizedPnl: parseFloat(ap.position.unrealizedPnl),
            liquidationPrice: ap.position.liquidationPx != null
              ? parseFloat(ap.position.liquidationPx)
              : null,
          };
        });
      return { success: true, positions };
    },
  };
}
