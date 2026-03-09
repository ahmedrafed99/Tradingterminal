import api from './api';

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

let statusInflight: Promise<DatabaseStatus> | null = null;

export const databaseService = {
  async getStatus(): Promise<DatabaseStatus> {
    if (statusInflight) return statusInflight;
    statusInflight = api
      .get<DatabaseStatus>('/database/status')
      .then((res) => res.data)
      .finally(() => { statusInflight = null; });
    return statusInflight;
  },

  async startFetch(params: {
    contractId: string;
    mode: 'sync' | 'range';
    startTime?: string;
    endTime?: string;
  }): Promise<FetchJobResult> {
    const res = await api.post<FetchJobResult>('/database/fetch', params);
    return res.data;
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
};
