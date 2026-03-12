import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import {
  databaseService,
  type DatabaseStatus,
  type FetchProgress,
} from '../../services/databaseService';
import { SECTION_LABEL } from '../../constants/styles';
import {
  COLOR_TEXT, COLOR_TEXT_MUTED, COLOR_TEXT_DIM, COLOR_BORDER,
  COLOR_SURFACE, COLOR_ACCENT, COLOR_ACCENT_HOVER, COLOR_INPUT,
  COLOR_BUY, COLOR_SELL, COLOR_WARNING,
} from '../../constants/colors';

const POLL_INTERVAL = 1500;

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
    } catch {
      // silent
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
      } catch {
        // silent
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
      } catch {
        // silent
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
    try { await databaseService.cancelFetch(); } catch { /* silent */ }
  }

  async function handleDelete(contractId: string) {
    try {
      await databaseService.deleteContract(contractId);
      refreshStatus();
    } catch { /* silent */ }
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

  return (
    <div style={{ padding: '20px 32px 24px' }}>
      {/* STATUS SECTION */}
      <div style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span className={SECTION_LABEL}>
            Stored Data
          </span>
          <span className="text-[10px]" style={{ color: COLOR_TEXT_DIM }}>
            {formatBytes(status?.dbSizeBytes ?? 0)}
          </span>
        </div>

        {status?.contracts?.length ? (
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${COLOR_BORDER}` }}>
            {status.contracts.map((c, i) => (
              <div
                key={c.contractId}
                className="flex items-center justify-between transition-colors"
                style={{
                  padding: '10px 12px',
                  borderTop: i > 0 ? `1px solid ${COLOR_BORDER}` : undefined,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLOR_SURFACE; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="text-xs" style={{ marginBottom: 2, color: COLOR_TEXT }}>
                    {c.contractId}
                  </div>
                  <div className="text-[10px]" style={{ color: COLOR_TEXT_MUTED }}>
                    {formatDate(c.oldestBar)} — {formatDate(c.newestBar)}
                    <span style={{ color: COLOR_TEXT_DIM }}> · </span>
                    {formatNumber(c.totalBars)} bars
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(c.contractId)}
                  disabled={isFetching}
                  className="hover:text-red-400 transition-colors disabled:opacity-50"
                  style={{ color: COLOR_TEXT_DIM }}
                  style={{ marginLeft: 8, fontSize: 11, lineHeight: 1 }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="text-xs text-center rounded-lg"
            style={{ padding: '16px 12px', border: `1px solid ${COLOR_BORDER}`, color: COLOR_TEXT_DIM }}
          >
            No data stored yet
          </div>
        )}
      </div>

      {/* DIVIDER */}
      <div style={{ borderTop: `1px solid ${COLOR_BORDER}`, marginBottom: 20 }} />

      {/* SYNC CONTROLS */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span className={SECTION_LABEL}>
            Sync
          </span>
          <span className="text-[10px]" style={{ color: COLOR_TEXT_DIM }}>
            Auto-sync every 30 min
          </span>
        </div>

        <button
          onClick={handleSync}
          disabled={isFetching || loading || !contract || !hasData}
          className="text-[11px] font-medium rounded-lg text-white transition-colors disabled:opacity-50"
          style={{ padding: '7px 16px', backgroundColor: COLOR_ACCENT }}
          onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = COLOR_ACCENT_HOVER; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLOR_ACCENT; }}
        >
          {isFetching ? 'Syncing…' : 'Sync Now'}
        </button>

        {!hasData && (
          <span className="text-[10px]" style={{ marginLeft: 8, color: COLOR_TEXT_DIM }}>
            No data to sync
          </span>
        )}
      </div>

      {/* PROGRESS */}
      {progress && (
        <div style={{ marginTop: 20 }}>
          <div style={{ borderTop: `1px solid ${COLOR_BORDER}`, marginBottom: 16 }} />

          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className={SECTION_LABEL}>
              Progress
            </span>
            <span className="text-[10px]">
              {progress.status === 'running' && (
                <span style={{ color: COLOR_TEXT_MUTED }}>Syncing…</span>
              )}
              {progress.status === 'completed' && (
                <span style={{ color: COLOR_BUY }}>Completed</span>
              )}
              {progress.status === 'failed' && (
                <span style={{ color: COLOR_SELL }}>Failed</span>
              )}
              {progress.status === 'cancelled' && (
                <span style={{ color: COLOR_WARNING }}>Cancelled</span>
              )}
            </span>
          </div>

          {/* Bar */}
          <div
            className="w-full overflow-hidden rounded-full"
            style={{ height: 4, backgroundColor: COLOR_INPUT, marginBottom: 8 }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress.pagesTotal > 0 ? (progress.pagesCompleted / progress.pagesTotal) * 100 : 0}%`,
                backgroundColor:
                  progress.status === 'completed' ? COLOR_BUY :
                  progress.status === 'failed' ? COLOR_SELL :
                  progress.status === 'cancelled' ? COLOR_WARNING : COLOR_ACCENT,
              }}
            />
          </div>

          <div className="flex items-center justify-between" style={{ marginBottom: progress.status === 'running' ? 10 : 0 }}>
            <span className="text-[10px]" style={{ color: COLOR_TEXT_MUTED }}>
              {progress.pagesCompleted} / {progress.pagesTotal} pages
            </span>
            {progress.barsInserted > 0 && (
              <span className="text-[10px]" style={{ color: COLOR_TEXT_MUTED }}>
                {formatNumber(progress.barsInserted)} bars inserted
              </span>
            )}
          </div>

          {progress.status === 'failed' && progress.errorMessage && (
            <div className="text-[10px]" style={{ marginTop: 4, color: COLOR_SELL }}>
              {progress.errorMessage}
            </div>
          )}

          {progress.status === 'running' && (
            <button
              onClick={handleCancel}
              className="text-[10px] hover:text-red-400 transition-colors"
              style={{ color: COLOR_TEXT_MUTED }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* BACKUP */}
      <div style={{ marginTop: 20 }}>
        <div style={{ borderTop: `1px solid ${COLOR_BORDER}`, marginBottom: 16 }} />

        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span className={SECTION_LABEL}>
            Backup
          </span>
          <span className="text-[10px]" style={{ color: COLOR_TEXT_DIM }}>
            Auto-backup daily · last 7 kept
          </span>
        </div>

        {/* Save to directory */}
        <div style={{ marginBottom: 10 }}>
          <span className="text-[10px]" style={{ display: 'block', marginBottom: 4, color: COLOR_TEXT_MUTED }}>
            Save to directory (leave empty for default)
          </span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <input
              type="text"
              value={backupDir}
              onChange={(e) => setBackupDir(e.target.value)}
              placeholder="C:\Users\Ahmed\Backups"
              className="flex-1 text-xs rounded-lg focus:outline-none disabled:opacity-50"
              style={{ padding: '8px 12px', border: `1px solid ${COLOR_BORDER}`, backgroundColor: COLOR_INPUT, color: COLOR_TEXT }}
            />
            <button
              onClick={handleBackup}
              disabled={backupLoading || !hasData}
              className="text-[11px] font-medium rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ padding: '7px 16px', whiteSpace: 'nowrap', backgroundColor: COLOR_ACCENT }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = COLOR_ACCENT_HOVER; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = COLOR_ACCENT; }}
            >
              {backupLoading ? 'Saving…' : 'Save Backup'}
            </button>
          </div>
        </div>

        {/* Download link */}
        <button
          onClick={handleDownload}
          disabled={!hasData}
          className="text-[11px] transition-colors disabled:opacity-50"
          style={{ color: COLOR_TEXT_MUTED }}
          onMouseEnter={(e) => { e.currentTarget.style.color = COLOR_TEXT; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = COLOR_TEXT_MUTED; }}
        >
          Or download to browser →
        </button>

        {backupMsg && (
          <div
            className="text-[10px] rounded-lg"
            style={{
              marginTop: 8,
              padding: '6px 10px',
              backgroundColor: backupMsg.startsWith('Saved') ? 'rgba(38,166,154,0.1)' : 'rgba(239,83,80,0.1)',
              color: backupMsg.startsWith('Saved') ? COLOR_BUY : COLOR_SELL,
            }}
          >
            {backupMsg}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p
          className="text-xs text-red-400 rounded-lg"
          style={{ marginTop: 12, padding: '8px 12px', backgroundColor: 'rgba(239,83,80,0.1)' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
