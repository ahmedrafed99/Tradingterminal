import { getAdapter, isConnected } from '../adapters/registry';
import * as databaseService from './databaseService';
import type { CandleRow } from './databaseService';

// ---------------------------------------------------------------------------
// Backfill service — paginated fetch from ProjectX API into SQLite
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 20000;
const PAGE_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Contract → symbol mapping (continuous futures)
// Maps specific contract IDs to a base symbol for unified storage.
// e.g. CON.F.US.ENQ.H26, CON.F.US.ENQ.Z25 → "NQ"
// ---------------------------------------------------------------------------

const PRODUCT_TO_SYMBOL: Record<string, string> = {
  ENQ: 'NQ',
  EP: 'ES',
  MNQ: 'MNQ',
  MES: 'MES',
  // Add more as needed
};

// Reverse map: symbol → product code (for auto-sync contract discovery)
const SYMBOL_TO_PRODUCT: Record<string, string> = Object.fromEntries(
  Object.entries(PRODUCT_TO_SYMBOL).map(([product, symbol]) => [symbol, product]),
);

const AUTO_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

/** Extract base symbol from a contract ID. Returns the ID unchanged if no mapping. */
export function contractToSymbol(contractId: string): string {
  // CON.F.US.<PRODUCT>.<MONTH_YEAR> → extract product
  const match = contractId.match(/^CON\.F\.US\.([^.]+)\./);
  if (match) {
    const product = match[1];
    if (PRODUCT_TO_SYMBOL[product]) return PRODUCT_TO_SYMBOL[product];
  }
  return contractId;
}

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

export interface FetchJob {
  jobId: string;
  contractId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  pagesCompleted: number;
  pagesTotal: number;
  barsInserted: number;
  currentTimestamp: string | null;
  errorMessage: string | null;
}

let currentJob: FetchJob | null = null;
let cancelRequested = false;
let jobCounter = 0;
let fetchLock = false;

export function getProgress(): FetchJob | { status: 'idle' } {
  return currentJob ?? { status: 'idle' as const };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export function cancel(): boolean {
  if (!currentJob || currentJob.status !== 'running') return false;
  cancelRequested = true;
  return true;
}

// ---------------------------------------------------------------------------
// Start fetch
// ---------------------------------------------------------------------------

export async function startFetch(params: {
  contractId: string;
  mode: 'sync' | 'range';
  startTime?: string; // ISO 8601
  endTime?: string;   // ISO 8601
}): Promise<{ jobId: string; estimatedPages: number }> {
  if (fetchLock || currentJob?.status === 'running') {
    throw new Error('A fetch job is already running');
  }
  fetchLock = true;
  if (!isConnected()) {
    fetchLock = false;
    throw new Error('Not connected to exchange');
  }

  const { contractId, mode } = params;
  const storageSymbol = contractToSymbol(contractId);
  let startEpoch: number;
  let endEpoch: number;

  const now = Date.now();

  if (mode === 'sync') {
    // Find newest stored bar — look up by storage symbol (e.g. "NQ"), not raw contract ID
    const status = databaseService.getStatus();
    const contract = status.contracts.find((c) => c.contractId === storageSymbol);
    if (!contract) {
      throw new Error(
        'No existing data for this contract. Use "range" mode for initial fetch.',
      );
    }
    startEpoch = contract.newestBar * 1000; // ms for API
    endEpoch = now;
  } else {
    if (!params.startTime || !params.endTime) {
      throw new Error('startTime and endTime are required for range mode');
    }
    startEpoch = new Date(params.startTime).getTime();
    endEpoch = new Date(params.endTime).getTime();
  }

  // Estimate pages
  const rangeMs = endEpoch - startEpoch;
  const estimatedBars = Math.ceil(rangeMs / 60000); // ~1 bar per minute
  const estimatedPages = Math.max(1, Math.ceil(estimatedBars / PAGE_LIMIT));

  const jobId = `fetch_${Date.now()}_${++jobCounter}`;

  currentJob = {
    jobId,
    contractId,
    status: 'running',
    pagesCompleted: 0,
    pagesTotal: estimatedPages,
    barsInserted: 0,
    currentTimestamp: null,
    errorMessage: null,
  };
  cancelRequested = false;

  // Run in background — don't await
  runFetch(contractId, storageSymbol, startEpoch, endEpoch)
    .catch((err) => {
      if (currentJob && currentJob.jobId === jobId) {
        currentJob.status = 'failed';
        currentJob.errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
      }
    })
    .finally(() => { fetchLock = false; });

  return { jobId, estimatedPages };
}

// ---------------------------------------------------------------------------
// Internal — paginated fetch loop
// ---------------------------------------------------------------------------

async function runFetch(
  contractId: string,
  storageSymbol: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  const startIso = new Date(startMs).toISOString();
  // endCursor moves backward as we paginate (API returns bars descending)
  let endCursor = new Date(endMs).toISOString();

  while (true) {
    if (cancelRequested) {
      if (currentJob) currentJob.status = 'cancelled';
      return;
    }

    const adapter = getAdapter();
    const response = (await adapter.marketData.retrieveBars({
      contractId,
      live: false,
      unit: 2, // minutes
      unitNumber: 1,
      startTime: startIso,
      endTime: endCursor,
      limit: PAGE_LIMIT,
      includePartialBar: false,
    })) as {
      success: boolean;
      bars: Array<{
        t: string;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }> | null;
      errorMessage?: string;
    };

    if (!response.success) {
      throw new Error(response.errorMessage ?? 'API returned success=false');
    }

    const bars = response.bars ?? [];

    if (bars.length === 0) {
      if (currentJob) {
        currentJob.status = 'completed';
        currentJob.pagesTotal = currentJob.pagesCompleted;
      }
      return;
    }

    // Convert API bars to DB rows — store under base symbol (e.g. "NQ")
    const rows: CandleRow[] = bars.map((bar) => ({
      contract_id: storageSymbol,
      timestamp: Math.floor(new Date(bar.t).getTime() / 1000),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));

    const inserted = databaseService.insertCandles(rows);

    // API returns descending: bars[0] = newest, bars[last] = oldest
    const oldestBarTime = bars[bars.length - 1].t;

    if (currentJob) {
      currentJob.pagesCompleted++;
      currentJob.barsInserted += inserted;
      currentJob.currentTimestamp = oldestBarTime;
    }

    // If we got fewer bars than the limit, we've fetched everything
    if (bars.length < PAGE_LIMIT) {
      if (currentJob) {
        currentJob.status = 'completed';
        currentJob.pagesTotal = currentJob.pagesCompleted;
      }
      return;
    }

    // Move end cursor to just before the oldest bar in this page
    const oldestMs = new Date(oldestBarTime).getTime();
    endCursor = new Date(oldestMs - 60000).toISOString(); // -1 minute

    // If cursor has moved past our start, we're done
    if (oldestMs <= startMs) {
      if (currentJob) {
        currentJob.status = 'completed';
        currentJob.pagesTotal = currentJob.pagesCompleted;
      }
      return;
    }

    // Delay between pages to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }
}

// ---------------------------------------------------------------------------
// Auto-sync — periodically syncs all known symbols in the database
// ---------------------------------------------------------------------------

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

/** Find the active contract ID for a symbol by searching the API. */
async function resolveActiveContract(symbol: string): Promise<string | null> {
  const product = SYMBOL_TO_PRODUCT[symbol];
  if (!product) return null;

  try {
    const adapter = getAdapter();
    const result = (await adapter.marketData.searchContracts(product, false)) as {
      contracts?: Array<{ id: string; activeContract?: boolean }>;
    };

    const contracts = result.contracts ?? [];
    const matching = contracts.filter((c) => c.id.startsWith(`CON.F.US.${product}.`));

    // Prefer the one explicitly marked active
    const active = matching.find((c) => c.activeContract);
    if (active) return active.id;

    // Rollover fallback: pick the latest contract alphabetically (e.g. M26 > H26)
    if (matching.length > 0) {
      matching.sort((a, b) => b.id.localeCompare(a.id));
      console.log(`[auto-sync] No active flag for ${symbol}, falling back to ${matching[0].id}`);
      return matching[0].id;
    }

    console.log(`[auto-sync] No contracts found for ${symbol} (product: ${product})`);
    return null;
  } catch (err) {
    console.log(`[auto-sync] Failed to resolve contract for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function autoSyncAll(): Promise<void> {
  if (!isConnected()) return;
  if (currentJob?.status === 'running') return; // don't interfere with manual fetch

  const { contracts } = databaseService.getStatus();
  if (contracts.length === 0) return;

  for (const entry of contracts) {
    // Only auto-sync symbols we know how to map (NQ, ES, etc.)
    if (!SYMBOL_TO_PRODUCT[entry.contractId]) continue;

    const activeContractId = await resolveActiveContract(entry.contractId);
    if (!activeContractId) {
      console.log(`[auto-sync] No active contract found for ${entry.contractId}, skipping`);
      continue;
    }

    // Skip if another job started while we were resolving
    if ((currentJob as FetchJob | null)?.status === 'running') break;

    try {
      console.log(`[auto-sync] Syncing ${entry.contractId} via ${activeContractId}`);
      await startFetch({ contractId: activeContractId, mode: 'sync' });

      // Wait for the job to finish before syncing the next symbol
      while ((currentJob as FetchJob | null)?.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (currentJob?.status === 'completed') {
        console.log(`[auto-sync] ${entry.contractId}: +${currentJob.barsInserted} bars`);
      } else if (currentJob?.status === 'failed') {
        console.log(`[auto-sync] ${entry.contractId} failed: ${currentJob.errorMessage}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[auto-sync] ${entry.contractId} error: ${msg}`);
    }
  }
}

export function startAutoSync(): void {
  // Initial sync after a short delay (let auth settle)
  setTimeout(() => { autoSyncAll().catch((err) => {
    console.error('[auto-sync] Initial sync failed:', err instanceof Error ? err.message : err);
  }); }, 10_000);

  autoSyncTimer = setInterval(() => {
    autoSyncAll().catch((err) => {
      console.error('[auto-sync] Periodic sync failed:', err instanceof Error ? err.message : err);
    });
  }, AUTO_SYNC_INTERVAL);

  console.log('[auto-sync] Enabled (every 30 minutes)');
}

export function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}
