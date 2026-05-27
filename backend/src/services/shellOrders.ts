/**
 * shellOrders.ts — TypeScript wrappers around claude-tools.sh functions.
 *
 * All strategies should use these instead of placing orders directly.
 * The shell script is the single source of truth for execution logic.
 */

import { spawn } from 'child_process';
import path from 'path';
import { debugLog } from '../utils/debugLog';

// claude-tools.sh lives in the backend root (same dir as cwd when the backend starts)
const SCRIPT_PATH = path.resolve(process.cwd(), 'claude-tools.sh');

// Convert a Windows absolute path to a Git Bash POSIX path: C:\foo\bar → /c/foo/bar
function toBashPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
}

const BASH_SCRIPT = toBashPath(SCRIPT_PATH);

// ─── marketmulti ─────────────────────────────────────────────────────────────

export interface MarketMultiParams {
  direction: 'buy' | 'sell';
  size: number;
  /** Stop distance in points. For trailing stops this is the trail distance. */
  slPts: number;
  targets: Array<{ tp_pts: number; contracts: number }>;
  /** If true, uses a trailing stop instead of a hard stop. */
  trailing?: boolean;
  contractId: string;
  accountId: string;
}

/**
 * Calls `marketmulti` from claude-tools.sh in a bash subprocess.
 *
 * Handles: entry market order → wait for fill → place SL (fixed or trailing) → place each TP.
 * All output lines are forwarded to debugLog and console.
 */
export function shellMarketMulti(params: MarketMultiParams): Promise<void> {
  const { direction, size, slPts, targets, trailing, contractId, accountId } = params;

  const tpSpecs = targets.map((t) => `${t.tp_pts}:${t.contracts}`);
  const args = [direction, String(size), String(slPts), ...tpSpecs];
  if (trailing) args.push('trail');
  args.push(contractId);

  const cmd = `source '${BASH_SCRIPT}' && marketmulti ${args.join(' ')}`;

  debugLog.log('[shellOrders] marketmulti', {
    args: `marketmulti ${args.join(' ')}`,
    accountId,
  });

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', cmd], {
      env: { ...process.env, ACCT: accountId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').filter(Boolean)) {
        debugLog.log('[shellOrders]', line);
        console.log('[shellOrders]', line);
      }
    });

    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) debugLog.log('[shellOrders:err]', msg);
    });

    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`marketmulti exited with code ${code}`));
    });

    proc.on('error', (err) => {
      debugLog.log('[shellOrders:err]', err.message);
      reject(err);
    });
  });
}
