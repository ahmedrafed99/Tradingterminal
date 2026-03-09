import { getAdapter, isConnected } from '../adapters/registry';
import * as databaseService from './databaseService';
import type { CandleRow } from './databaseService';

// ---------------------------------------------------------------------------
// Backfill service — paginated fetch from ProjectX API into SQLite
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 20000;
const PAGE_DELAY_MS = 500;

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
  if (currentJob?.status === 'running') {
    throw new Error('A fetch job is already running');
  }
  if (!isConnected()) {
    throw new Error('Not connected to exchange');
  }

  const { contractId, mode } = params;
  let startEpoch: number;
  let endEpoch: number;

  const now = Date.now();

  if (mode === 'sync') {
    // Find newest stored bar and fetch from there
    const status = databaseService.getStatus();
    const contract = status.contracts.find((c) => c.contractId === contractId);
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
  runFetch(contractId, startEpoch, endEpoch).catch((err) => {
    if (currentJob && currentJob.jobId === jobId) {
      currentJob.status = 'failed';
      currentJob.errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
    }
  });

  return { jobId, estimatedPages };
}

// ---------------------------------------------------------------------------
// Internal — paginated fetch loop
// ---------------------------------------------------------------------------

async function runFetch(
  contractId: string,
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

    // Convert API bars to DB rows
    const rows: CandleRow[] = bars.map((bar) => ({
      contract_id: contractId,
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
