import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import {
  databaseService,
  type DatabaseStatus,
  type FetchProgress,
} from '../../services/databaseService';

const POLL_INTERVAL = 1500;
const SECTION_TITLE = 'text-[11px] font-medium text-(--color-text-muted) uppercase tracking-wider';
const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-xs text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent)/50 transition-all disabled:opacity-50';

export function DatabaseTab() {
  const { contract } = useStore();

  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupDir, setBackupDir] = useState('');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await databaseService.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('[DatabaseTab] Status fetch failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const p = await databaseService.getProgress();
        if (p.status === 'idle') {
          setProgress(null);
          stopPolling();
          refreshStatus();
        } else {
          setProgress(p as FetchProgress);
          if (p.status !== 'running') {
            stopPolling();
            refreshStatus();
          }
        }
      } catch (err) {
        console.error('[DatabaseTab] Progress poll failed:', err instanceof Error ? err.message : err);
      }
    }, POLL_INTERVAL);
  }, [refreshStatus]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const p = await databaseService.getProgress();
        if (p.status === 'running') {
          setProgress(p as FetchProgress);
          startPolling();
        }
      } catch (err) {
        console.error('[DatabaseTab] Initial progress check failed:', err instanceof Error ? err.message : err);
      }
    })();
    return () => stopPolling();
  }, [startPolling]);

  const isFetching = progress?.status === 'running';

  async function handleSync() {
    if (!contract) return;
    setError(null);
    setLoading(true);
    try {
      await databaseService.startFetch({ contractId: contract.id, mode: 'sync' });
      startPolling();
      setProgress({
        jobId: '', status: 'running', pagesCompleted: 0, pagesTotal: 1,
        barsInserted: 0, currentTimestamp: null, errorMessage: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sync');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    try { await databaseService.cancelFetch(); } catch (err) {
      console.error('[DatabaseTab] Cancel failed:', err instanceof Error ? err.message : err);
    }
  }

  async function handleDelete(contractId: string) {
    try {
      await databaseService.deleteContract(contractId);
      refreshStatus();
    } catch (err) {
      console.error('[DatabaseTab] Delete failed:', err instanceof Error ? err.message : err);
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(epoch: number): string {
    return new Date(epoch * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  async function handleBackup() {
    setBackupMsg(null);
    setBackupLoading(true);
    try {
      const result = await databaseService.backupTo(backupDir || undefined);
      setBackupMsg(`Saved to ${result.path}`);
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackupLoading(false);
    }
  }

  function handleDownload() {
    databaseService.downloadBackup();
  }

  const hasData = (status?.contracts?.length ?? 0) > 0;

  const progressPct = progress && progress.pagesTotal > 0
    ? (progress.pagesCompleted / progress.pagesTotal) * 100
    : 0;

  return (
    <div style={{ padding: '20px 24px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* STORED DATA */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Stored Data</span>
            <span className="text-[10px] text-(--color-text-dim)">
              {formatBytes(status?.dbSizeBytes ?? 0)}
            </span>
          </div>

          {status?.contracts?.length ? (
            <div className="rounded-lg overflow-hidden border border-(--color-border)/30">
              {status.contracts.map((c, i) => (
                <div
                  key={c.contractId}
                  className="group/row flex items-center justify-between transition-colors hover:bg-(--color-hover-row)/30"
                  style={{
                    padding: '10px 12px',
                    borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="text-xs text-white" style={{ marginBottom: 2 }}>
                      {c.contractId}
                    </div>
                    <div className="text-[10px] text-(--color-text-muted)">
                      {formatDate(c.oldestBar)} — {formatDate(c.newestBar)}
                      <span className="text-(--color-text-dim)"> · </span>
                      {formatNumber(c.totalBars)} bars
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(c.contractId)}
                    disabled={isFetching}
                    className="opacity-0 group-hover/row:opacity-100 text-(--color-text-dim) hover:text-(--color-error) transition-all disabled:opacity-50 shrink-0"
                    style={{ padding: 4 }}
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="text-xs text-center rounded-lg border border-(--color-border)/30 text-(--color-text-dim)"
              style={{ padding: '16px 12px' }}
            >
              No data stored yet
            </div>
          )}
        </div>

        {/* SYNC */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Sync</span>
            <span className="text-[10px] text-(--color-text-dim)">Auto-sync every 30 min</span>
          </div>

          <div className="flex items-center" style={{ gap: 10 }}>
            <button
              onClick={handleSync}
              disabled={isFetching || loading || !contract || !hasData}
              className="text-[11px] font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
              style={{ padding: '7px 18px' }}
            >
              {isFetching ? 'Syncing...' : 'Sync Now'}
            </button>

            {!hasData && (
              <span className="text-[10px] text-(--color-text-dim)">No data to sync</span>
            )}
          </div>
        </div>

        {/* PROGRESS */}
        {progress && (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <span className={SECTION_TITLE}>Progress</span>
              <span className="text-[10px]">
                {progress.status === 'running' && (
                  <span className="text-(--color-text-muted)">Syncing...</span>
                )}
                {progress.status === 'completed' && (
                  <span className="text-(--color-buy)">Completed</span>
                )}
                {progress.status === 'failed' && (
                  <span className="text-(--color-sell)">Failed</span>
                )}
                {progress.status === 'cancelled' && (
                  <span className="text-(--color-warning)">Cancelled</span>
                )}
              </span>
            </div>

            {/* Progress bar */}
            <div
              className="w-full overflow-hidden rounded-full"
              style={{ height: 4, marginBottom: 8, background: 'var(--color-input)' }}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress.status === 'completed' ? 'bg-(--color-buy)' :
                  progress.status === 'failed' ? 'bg-(--color-sell)' :
                  progress.status === 'cancelled' ? 'bg-(--color-warning)' : 'bg-(--color-accent)'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-(--color-text-muted)">
                {progress.pagesCompleted} / {progress.pagesTotal} pages
              </span>
              {progress.barsInserted > 0 && (
                <span className="text-[10px] text-(--color-text-muted)">
                  {formatNumber(progress.barsInserted)} bars inserted
                </span>
              )}
            </div>

            {progress.status === 'failed' && progress.errorMessage && (
              <div className="text-[10px] text-(--color-sell)" style={{ marginTop: 6 }}>
                {progress.errorMessage}
              </div>
            )}

            {progress.status === 'running' && (
              <button
                onClick={handleCancel}
                className="text-[10px] text-(--color-text-muted) hover:text-(--color-error) transition-colors"
                style={{ marginTop: 8 }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* BACKUP */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Backup</span>
            <span className="text-[10px] text-(--color-text-dim)">Auto-backup daily · last 7 kept</span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="block text-[11px] text-(--color-text-muted)" style={{ marginBottom: 6 }}>
              Save to directory (leave empty for default)
            </span>
            <div className="flex items-center" style={{ gap: 8 }}>
              <input
                type="text"
                value={backupDir}
                onChange={(e) => setBackupDir(e.target.value)}
                placeholder="C:\Users\Ahmed\Backups"
                className={`flex-1 ${INPUT_CLS}`}
                style={{ padding: '8px 12px' }}
              />
              <button
                onClick={handleBackup}
                disabled={backupLoading || !hasData}
                className="text-[11px] font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50 shrink-0"
                style={{ padding: '7px 18px', whiteSpace: 'nowrap' }}
              >
                {backupLoading ? 'Saving...' : 'Save Backup'}
              </button>
            </div>
          </div>

          <button
            onClick={handleDownload}
            disabled={!hasData}
            className="text-[11px] text-(--color-text-muted) hover:text-white transition-colors disabled:opacity-50"
          >
            Or download to browser →
          </button>

          {backupMsg && (
            <div
              className={`text-[10px] rounded-lg ${
                backupMsg.startsWith('Saved')
                  ? 'bg-(--color-buy)/10 text-(--color-buy)'
                  : 'bg-(--color-error)/10 text-(--color-error)'
              }`}
              style={{ marginTop: 8, padding: '6px 10px' }}
            >
              {backupMsg}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p
          className="text-xs text-(--color-error) bg-(--color-error)/10 rounded-lg text-center"
          style={{ marginTop: 16, padding: '10px 16px' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
