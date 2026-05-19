import api from './api';
import { dedup } from '../utils/dedup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractStatus {
  contractId: string;
  oldestBar: number;
  newestBar: number;
  totalBars: number;
}

export interface DatabaseStatus {
  contracts: ContractStatus[];
  dbSizeBytes: number;
}

export interface FetchJobResult {
  jobId: string;
  estimatedPages: number;
}

export interface FetchProgress {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  pagesCompleted: number;
  pagesTotal: number;
  barsInserted: number;
  currentTimestamp: string | null;
  errorMessage: string | null;
}

export type FetchProgressOrIdle = FetchProgress | { status: 'idle' };

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const databaseService = {
  getStatus: dedup(async (): Promise<DatabaseStatus> => {
    const res = await api.get<DatabaseStatus>('/database/status');
    return res.data;
  }),

  async startFetch(params: {
    contractId: string;
    mode: 'sync' | 'range';
    startTime?: string;
    endTime?: string;
  }): Promise<FetchJobResult> {
    const res = await api.post<FetchJobResult>('/database/fetch', params);
    return res.data;
  },

  async syncAll(): Promise<void> {
    await api.post('/database/fetch/sync-all');
  },

  async getProgress(): Promise<FetchProgressOrIdle> {
    const res = await api.get<FetchProgressOrIdle>('/database/fetch/progress');
    return res.data;
  },

  async cancelFetch(): Promise<void> {
    await api.post('/database/fetch/cancel');
  },

  async deleteContract(contractId: string): Promise<void> {
    await api.delete(`/database/contracts/${encodeURIComponent(contractId)}`);
  },

  async backupTo(directory?: string): Promise<{ success: boolean; path: string; filename: string }> {
    const res = await api.post<{ success: boolean; path: string; filename: string }>(
      '/database/backup',
      directory ? { directory } : {},
    );
    return res.data;
  },

  downloadBackup(): void {
    window.open('/database/backup/download', '_blank');
  },

  async listBackups(): Promise<{ filename: string; sizeBytes: number; created: string }[]> {
    const res = await api.get<{ backups: { filename: string; sizeBytes: number; created: string }[] }>(
      '/database/backups',
    );
    return res.data.backups;
  },

  // ---------------------------------------------------------------------------
  // Kaggle cloud sync
  // ---------------------------------------------------------------------------

  async kaggleStatus(): Promise<KaggleStatus> {
    const res = await api.get<KaggleStatus>('/database/kaggle/status');
    return res.data;
  },

  async kagglePull(): Promise<KagglePullResult> {
    const res = await api.post<KagglePullResult>(
      '/database/kaggle/pull',
      undefined,
      { timeout: 0 }, // downloads can be hundreds of MB
    );
    return res.data;
  },

  async kaggleStaged(): Promise<KaggleStagedResult> {
    const res = await api.get<KaggleStagedResult>('/database/kaggle/staged');
    return res.data;
  },

  async kaggleMerge(): Promise<KaggleMergeResult> {
    const res = await api.post<KaggleMergeResult>('/database/kaggle/merge');
    return res.data;
  },

  async kaggleDiscard(): Promise<{ success: boolean; removed: boolean }> {
    const res = await api.post<{ success: boolean; removed: boolean }>('/database/kaggle/discard');
    return res.data;
  },

  async kagglePush(): Promise<{ success: boolean; errorMessage?: string }> {
    const res = await api.post<{ success: boolean; errorMessage?: string }>(
      '/database/kaggle/push',
      undefined,
      { timeout: 0 }, // uploads can take a while
    );
    return res.data;
  },
};

// ---------------------------------------------------------------------------
// Kaggle types
// ---------------------------------------------------------------------------

export interface KaggleStatus {
  success: boolean;
  errorMessage?: string;
  kaggle?: { datasetId: string; lastUpdated: string; sizeBytes: number };
  local: { lastUpdated: string | null; sizeBytes: number; hasData: boolean };
  isKaggleAhead?: boolean;
  isLocalAhead?: boolean;
}

export interface StagedSummary {
  path: string;
  sizeBytes: number;
  timeframeSeconds: number | null;
  contracts: ContractStatus[];
}

export interface KagglePullResult {
  success: boolean;
  errorMessage?: string;
  staged: StagedSummary | null;
  validationError: string | null;
}

export interface KaggleStagedResult {
  success: boolean;
  errorMessage?: string;
  staged: StagedSummary | null;
  validationError: string | null;
}

export interface OverlapEntry {
  contractId: string;
  count: number;
  firstTimestamp: number;
}

export interface KaggleMergeResult {
  success: boolean;
  errorMessage?: string;
  merged?: number;
  overlaps?: OverlapEntry[];
  stagedTimeframeSeconds?: number | null;
  liveTimeframeSeconds?: number;
}
