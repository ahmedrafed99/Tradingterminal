import axios, { AxiosError } from 'axios';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import { encode } from '@msgpack/msgpack';

// ---------------------------------------------------------------------------
// Shared state — passed in from createHyperliquidAdapter(), lives in closure
// ---------------------------------------------------------------------------
export interface HlState {
  privateKey: `0x${string}` | null;
  walletAddress: `0x${string}` | null;
  connected: boolean;
  isTestnet: boolean;
  apiUrl: string;
}

// ---------------------------------------------------------------------------
// floatToWire — format a number for the HL API (max 8dp, never sci notation)
// ---------------------------------------------------------------------------
export function floatToWire(n: number): string {
  // Use toFixed to avoid scientific notation, then strip trailing zeros
  const fixed = n.toFixed(8);
  const stripped = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  // Sanity check — should never happen with toFixed(8)
  if (stripped.includes('e') || stripped.includes('E')) {
    throw new Error(`floatToWire: cannot represent ${n} safely`);
  }
  return stripped || '0';
}

// ---------------------------------------------------------------------------
// roundToSigFigs — HL enforces max 5 significant figures on prices
// ---------------------------------------------------------------------------
export function roundToSigFigs(n: number, sigFigs: number): number {
  if (n === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(n)));
  const factor = Math.pow(10, sigFigs - 1 - magnitude);
  return Math.round(n * factor) / factor;
}

// ---------------------------------------------------------------------------
// hashAction — keccak256 of msgpack(action) + nonce (8-byte BE) + 0x00
// ---------------------------------------------------------------------------
function hashAction(
  action: Record<string, unknown>,
  nonce: number,
  vaultAddress?: string,
): `0x${string}` {
  const msgBytes = Buffer.from(encode(action));
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64BE(BigInt(nonce));

  let extra: Buffer;
  if (vaultAddress) {
    const addrHex = vaultAddress.startsWith('0x') ? vaultAddress.slice(2) : vaultAddress;
    extra = Buffer.concat([Buffer.from([1]), Buffer.from(addrHex, 'hex')]);
  } else {
    extra = Buffer.from([0]);
  }

  const combined = Buffer.concat([msgBytes, nonceBuffer, extra]);
  // keccak256 accepts Uint8Array (Buffer extends it)
  return keccak256(combined as unknown as Uint8Array);
}

// ---------------------------------------------------------------------------
// HlClient — the only HTTP interface used by all sub-modules
// ---------------------------------------------------------------------------
export interface HlClient {
  /** Read-only queries — POST /info, no auth needed */
  info<T>(payload: Record<string, unknown>): Promise<T>;
  /** Signed writes — POST /exchange */
  exchange(action: Record<string, unknown>, vaultAddress?: string): Promise<unknown>;
  /** Wallet address for user-scoped queries */
  getWalletAddress(): string;
}

function wrapError(context: string, err: unknown): Error {
  if (err instanceof AxiosError) {
    const data = err.response?.data;
    let msg: string;
    if (typeof data === 'string') {
      msg = data;
    } else if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      msg = (d['error'] ?? d['detail'] ?? d['message'] ?? JSON.stringify(data)) as string;
    } else {
      msg = err.message;
    }
    return new Error(`[HL] ${context}: ${msg}`);
  }
  if (err instanceof Error) {
    return new Error(`[HL] ${context}: ${err.message}`);
  }
  return new Error(`[HL] ${context}: unknown error`);
}

export function createClient(state: HlState): HlClient {
  async function info<T>(payload: Record<string, unknown>): Promise<T> {
    try {
      const res = await axios.post<T>(`${state.apiUrl}/info`, payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      return res.data;
    } catch (err) {
      throw wrapError(`info(${payload['type']})`, err);
    }
  }

  async function exchange(
    action: Record<string, unknown>,
    vaultAddress?: string,
  ): Promise<unknown> {
    if (!state.privateKey) {
      throw new Error('[HL] Not connected — call auth.connect() first');
    }

    const nonce = Date.now();
    const connectionId = hashAction(action, nonce, vaultAddress);

    const account = privateKeyToAccount(state.privateKey);
    let rawSig: `0x${string}`;
    try {
      rawSig = await account.signTypedData({
        domain: {
          chainId: 1337,
          name: 'Exchange',
          verifyingContract: '0x0000000000000000000000000000000000000000',
          version: '1',
        },
        types: {
          Agent: [
            { name: 'source', type: 'string' },
            { name: 'connectionId', type: 'bytes32' },
          ],
        },
        primaryType: 'Agent',
        message: {
          source: state.isTestnet ? 'b' : 'a',
          connectionId,
        },
      });
    } catch (err) {
      throw wrapError('signTypedData', err);
    }

    // Split 65-byte hex sig into { r, s, v }
    const r = `0x${rawSig.slice(2, 66)}` as `0x${string}`;
    const s = `0x${rawSig.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(rawSig.slice(130, 132), 16);

    const body: Record<string, unknown> = {
      action,
      nonce,
      signature: { r, s, v },
    };
    if (vaultAddress) body['vaultAddress'] = vaultAddress;

    if (process.env.HL_DEBUG) {
      console.log('[HL debug] exchange body:', JSON.stringify(body, null, 2));
    }

    try {
      const res = await axios.post<{ status: string; response: unknown }>(
        `${state.apiUrl}/exchange`,
        body,
        { headers: { 'Content-Type': 'application/json' } },
      );
      const data = res.data;
      // HL returns HTTP 200 even for logical errors — check status field
      if (data.status === 'err') {
        const msg = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
        throw new Error(`[HL] exchange(${action['type'] as string}) rejected: ${msg}`);
      }
      return data;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('[HL]')) throw err;
      throw wrapError(`exchange(${action['type']})`, err);
    }
  }

  return {
    info,
    exchange,
    getWalletAddress: () => state.walletAddress ?? '',
  };
}
