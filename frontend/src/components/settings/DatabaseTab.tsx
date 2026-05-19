import { useState, useEffect, useRef, useCallback } from 'react';
import {
  databaseService,
  type DatabaseStatus,
  type FetchProgress,
  type KaggleStatus,
  type StagedSummary,
  type OverlapEntry,
} from '../../services/databaseService';
import { formatRelativeTime, formatTimeframe, formatEpochUtc } from '../../utils/formatters';

type KaggleBusy = 'pull' | 'push' | 'merge' | 'discard' | null;

const POLL_INTERVAL = 1500;
const SECTION_TITLE = 'text-xs font-medium text-(--color-text) uppercase tracking-wider';
const INPUT_CLS = 'w-full bg-(--color-input) border border-(--color-border) rounded-lg text-sm text-(--color-text-bright) placeholder-(--color-text-dim) focus:outline-none focus:border-(--color-accent)/50 transition-all disabled:opacity-50';

export function DatabaseTab() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupDir, setBackupDir] = useState('');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [kaggle, setKaggle] = useState<KaggleStatus | null>(null);
  const [kaggleLoading, setKaggleLoading] = useState(false);
  const [kaggleBusy, setKaggleBusy] = useState<KaggleBusy>(null);
  const [kaggleMsg, setKaggleMsg] = useState<string | null>(null);
  const [kaggleMsgKind, setKaggleMsgKind] = useState<'success' | 'error' | null>(null);
  const [staged, setStaged] = useState<StagedSummary | null>(null);
  const [stagedValidationError, setStagedValidationError] = useState<string | null>(null);
  const [mergeOverlaps, setMergeOverlaps] = useState<OverlapEntry[] | null>(null);

  const setMsg = useCallback((text: string, kind: 'success' | 'error') => {
    setKaggleMsg(text);
    setKaggleMsgKind(kind);
  }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const dbStatus = await databaseService.getStatus();
      setStatus(dbStatus);
    } catch (err) {
      console.error('[DatabaseTab] Status fetch failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  const refreshKaggle = useCallback(async () => {
    setKaggleLoading(true);
    setKaggleMsg(null);
    try {
      const s = await databaseService.kaggleStatus();
      setKaggle(s);
    } catch (err) {
      console.error('[DatabaseTab] Kaggle status failed:', err instanceof Error ? err.message : err);
      setKaggle(null);
    } finally {
      setKaggleLoading(false);
    }
  }, []);

  const refreshStaged = useCallback(async () => {
    try {
      const s = await databaseService.kaggleStaged();
      setStaged(s.staged);
      setStagedValidationError(s.validationError);
    } catch (err) {
      console.error('[DatabaseTab] Staged status failed:', err instanceof Error ? err.message : err);
      setStaged(null);
      setStagedValidationError(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshKaggle();
    refreshStaged();
  }, [refreshStatus, refreshKaggle, refreshStaged]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const dbProgress = await databaseService.getProgress();
        if (dbProgress.status === 'idle') {
          setProgress(null);
          stopPolling();
          refreshStatus();
        } else {
          setProgress(dbProgress as FetchProgress);
          if (dbProgress.status !== 'running') {
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
        const dbProgress = await databaseService.getProgress();
        if (dbProgress.status === 'running') {
          setProgress(dbProgress as FetchProgress);
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
    setError(null);
    setLoading(true);
    try {
      await databaseService.syncAll();
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

  async function withKaggleBusy(
    kind: Exclude<KaggleBusy, null>,
    label: string,
    fn: () => Promise<void>,
  ) {
    setKaggleBusy(kind);
    setKaggleMsg(null);
    setKaggleMsgKind(null);
    setMergeOverlaps(null);
    try {
      await fn();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : `${label} failed`, 'error');
    } finally {
      setKaggleBusy(null);
    }
  }

  function handleKagglePull() {
    return withKaggleBusy('pull', 'Pull', async () => {
      const result = await databaseService.kagglePull();
      if (!result.success) {
        setMsg(result.errorMessage || 'Pull failed', 'error');
        return;
      }
      setStaged(result.staged);
      setStagedValidationError(result.validationError);
      setMsg(
        result.staged
          ? `Pulled to staging (${formatBytes(result.staged.sizeBytes)}). Review and click Merge.`
          : 'Pulled, but no staged data detected.',
        'success',
      );
    });
  }

  function handleKagglePush() {
    return withKaggleBusy('push', 'Push', async () => {
      const result = await databaseService.kagglePush();
      if (!result.success) {
        setMsg(result.errorMessage || 'Push failed', 'error');
        return;
      }
      setMsg('Pushed to Kaggle', 'success');
      await refreshKaggle();
    });
  }

  function handleKaggleMerge() {
    return withKaggleBusy('merge', 'Merge', async () => {
      const result = await databaseService.kaggleMerge();
      if (!result.success) {
        setMsg(result.errorMessage || 'Merge refused', 'error');
        if (result.overlaps && result.overlaps.length > 0) {
          setMergeOverlaps(result.overlaps);
        }
        return;
      }
      setMsg(`Merged ${formatNumber(result.merged ?? 0)} rows into live DB.`, 'success');
      setStaged(null);
      setStagedValidationError(null);
      await refreshStatus();
      await refreshKaggle();
    });
  }

  function handleKaggleDiscard() {
    return withKaggleBusy('discard', 'Discard', async () => {
      await databaseService.kaggleDiscard();
      setStaged(null);
      setStagedValidationError(null);
      setMsg('Discarded staged file.', 'success');
    });
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
            <span className="text-[11px] text-(--color-text-muted)">
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
                    <div className="text-sm text-white" style={{ marginBottom: 2 }}>
                      {c.contractId}
                    </div>
                    <div className="text-[11px] text-(--color-text-muted)">
                      {formatDate(c.oldestBar)} — {formatDate(c.newestBar)}
                      <span className="text-(--color-text-muted)"> · </span>
                      {formatNumber(c.totalBars)} bars
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(c.contractId)}
                    disabled={isFetching}
                    className="opacity-0 group-hover/row:opacity-100 text-(--color-text-muted) hover:text-(--color-error) transition-all disabled:opacity-50 shrink-0"
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
              className="text-sm text-center rounded-lg border border-(--color-border)/30 text-(--color-text-muted)"
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
            <span className="text-[11px] text-(--color-text-muted)">Auto-sync every 30 min</span>
          </div>

          <div className="flex items-center" style={{ gap: 10 }}>
            <button
              onClick={handleSync}
              disabled={isFetching || loading || !hasData}
              className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
              style={{ padding: '7px 18px' }}
            >
              {isFetching ? 'Syncing...' : 'Sync Now'}
            </button>

            {!hasData && (
              <span className="text-[11px] text-(--color-text-muted)">No data to sync</span>
            )}
          </div>
        </div>

        {/* PROGRESS */}
        {progress && (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <span className={SECTION_TITLE}>Progress</span>
              <span className="text-[11px]">
                {progress.status === 'running' && (
                  <span className="text-(--color-text)">Syncing...</span>
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
              <span className="text-[11px] text-(--color-text)">
                {progress.pagesCompleted} / {progress.pagesTotal} pages
              </span>
              {progress.barsInserted > 0 && (
                <span className="text-[11px] text-(--color-text)">
                  {formatNumber(progress.barsInserted)} bars inserted
                </span>
              )}
            </div>

            {progress.status === 'failed' && progress.errorMessage && (
              <div className="text-[11px] text-(--color-sell)" style={{ marginTop: 6 }}>
                {progress.errorMessage}
              </div>
            )}

            {progress.status === 'running' && (
              <button
                onClick={handleCancel}
                className="text-[11px] text-(--color-text-muted) hover:text-(--color-error) transition-colors"
                style={{ marginTop: 8 }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* KAGGLE CLOUD SYNC */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Cloud Sync (Kaggle)</span>
            <button
              onClick={refreshKaggle}
              disabled={kaggleLoading || kaggleBusy !== null}
              className="text-[11px] text-(--color-text-muted) hover:text-white transition-colors disabled:opacity-50"
            >
              {kaggleLoading ? 'Checking…' : 'Refresh'}
            </button>
          </div>

          {kaggleLoading && !kaggle ? (
            <div
              className="text-sm text-center rounded-lg border border-(--color-border)/30 text-(--color-text-muted)"
              style={{ padding: '16px 12px' }}
            >
              Checking Kaggle…
            </div>
          ) : kaggle?.success === false || !kaggle?.kaggle ? (
            <div
              className="text-[11px] rounded-lg bg-(--color-error)/10 text-(--color-error)"
              style={{ padding: '10px 12px' }}
            >
              {kaggle?.errorMessage || 'Could not reach Kaggle.'}
            </div>
          ) : (
            <>
              {/* status rows */}
              <div className="rounded-lg overflow-hidden border border-(--color-border)/30" style={{ marginBottom: 10 }}>
                <div
                  className="flex items-center justify-between"
                  style={{ padding: '10px 12px' }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="text-sm text-white" style={{ marginBottom: 2 }}>Kaggle</div>
                    <div className="text-[11px] text-(--color-text-muted)">
                      {formatRelativeTime(kaggle.kaggle.lastUpdated)}
                      <span className="text-(--color-text-muted)"> · </span>
                      {formatBytes(kaggle.kaggle.sizeBytes)}
                    </div>
                  </div>
                  {kaggle.isKaggleAhead && (
                    <span className="text-[11px] bg-(--color-accent)/20 text-(--color-accent-text) rounded-md" style={{ padding: '3px 8px' }}>
                      ahead
                    </span>
                  )}
                </div>
                <div
                  className="flex items-center justify-between"
                  style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)' }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="text-sm text-white" style={{ marginBottom: 2 }}>Local</div>
                    <div className="text-[11px] text-(--color-text-muted)">
                      {kaggle.local.hasData ? (
                        <>
                          {formatRelativeTime(kaggle.local.lastUpdated)}
                          <span className="text-(--color-text-muted)"> · </span>
                          {formatBytes(kaggle.local.sizeBytes)}
                        </>
                      ) : (
                        <span>empty</span>
                      )}
                    </div>
                  </div>
                  {kaggle.isLocalAhead && (
                    <span className="text-[11px] bg-(--color-accent)/20 text-(--color-accent-text) rounded-md" style={{ padding: '3px 8px' }}>
                      ahead
                    </span>
                  )}
                </div>
              </div>

              {/* prompt + actions (hidden while a staged file is awaiting review) */}
              {staged ? (
                <div className="text-xs text-(--color-text-muted)" style={{ textAlign: 'center' }}>
                  Staged data from Kaggle is waiting below.
                </div>
              ) : kaggle.isKaggleAhead ? (
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <span className="text-xs text-(--color-text)">
                    Kaggle has a newer version. Pull to staging for review?
                  </span>
                  <button
                    onClick={handleKagglePull}
                    disabled={kaggleBusy !== null}
                    className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50 shrink-0"
                    style={{ padding: '7px 18px' }}
                  >
                    {kaggleBusy === 'pull' ? 'Pulling…' : 'Pull from Kaggle'}
                  </button>
                </div>
              ) : kaggle.isLocalAhead ? (
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <span className="text-xs text-(--color-text)">
                    Local is newer than Kaggle.
                  </span>
                  <button
                    onClick={handleKagglePush}
                    disabled={kaggleBusy !== null}
                    className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50 shrink-0"
                    style={{ padding: '7px 18px' }}
                  >
                    {kaggleBusy === 'push' ? 'Pushing…' : 'Push to Kaggle'}
                  </button>
                </div>
              ) : (
                <div className="text-xs text-(--color-text-muted)" style={{ textAlign: 'center' }}>
                  In sync.
                </div>
              )}

              {kaggleMsg && (
                <div
                  className={`text-[11px] rounded-lg ${
                    kaggleMsgKind === 'error'
                      ? 'bg-(--color-error)/10 text-(--color-error)'
                      : 'bg-(--color-buy)/10 text-(--color-buy)'
                  }`}
                  style={{ marginTop: 8, padding: '6px 10px' }}
                >
                  {kaggleMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* STAGED (only when a Kaggle pull has been downloaded but not merged) */}
        {staged && (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <span className={SECTION_TITLE}>Staged Data from Kaggle</span>
              <span className="text-[11px] text-(--color-text-muted)">
                {formatBytes(staged.sizeBytes)} · {formatTimeframe(staged.timeframeSeconds)}
              </span>
            </div>

            {staged.contracts.length > 0 ? (
              <div className="rounded-lg overflow-hidden border border-(--color-border)/30" style={{ marginBottom: 10 }}>
                {staged.contracts.map((c, i) => (
                  <div
                    key={c.contractId}
                    className="flex items-center justify-between"
                    style={{
                      padding: '10px 12px',
                      borderTop: i > 0 ? '1px solid var(--color-border)' : undefined,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="text-sm text-white" style={{ marginBottom: 2 }}>
                        {c.contractId}
                      </div>
                      <div className="text-[11px] text-(--color-text-muted)">
                        {formatDate(c.oldestBar)} — {formatDate(c.newestBar)}
                        <span className="text-(--color-text-muted)"> · </span>
                        {formatNumber(c.totalBars)} bars
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="text-sm text-center rounded-lg border border-(--color-border)/30 text-(--color-text-muted)"
                style={{ padding: '16px 12px', marginBottom: 10 }}
              >
                Staged file contains no rows
              </div>
            )}

            {stagedValidationError && (
              <div
                className="text-[11px] rounded-lg bg-(--color-error)/10 text-(--color-error)"
                style={{ padding: '8px 12px', marginBottom: 10 }}
              >
                {stagedValidationError}
              </div>
            )}

            {/* Overlap warning from a refused merge */}
            {mergeOverlaps && mergeOverlaps.length > 0 && (
              <div
                className="rounded-lg bg-(--color-error)/10 text-(--color-error)"
                style={{ padding: '10px 12px', marginBottom: 10 }}
              >
                <div className="text-xs font-medium" style={{ marginBottom: 6 }}>
                  Merge refused — staged data overlaps with existing rows:
                </div>
                <div className="text-[11px]">
                  {mergeOverlaps.map((o) => (
                    <div key={o.contractId} style={{ marginBottom: 2 }}>
                      {o.contractId}: {formatNumber(o.count)} overlapping rows · first at {formatEpochUtc(o.firstTimestamp)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end" style={{ gap: 8 }}>
              <button
                onClick={handleKaggleDiscard}
                disabled={kaggleBusy !== null}
                className="text-sm font-medium rounded-lg text-(--color-text-muted) hover:text-(--color-error) transition-all disabled:opacity-50"
                style={{ padding: '7px 14px' }}
              >
                {kaggleBusy === 'discard' ? 'Discarding…' : 'Discard'}
              </button>
              <button
                onClick={handleKaggleMerge}
                disabled={
                  kaggleBusy !== null ||
                  !!stagedValidationError ||
                  staged.contracts.length === 0 ||
                  staged.timeframeSeconds !== 60
                }
                className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50"
                style={{ padding: '7px 18px' }}
                title={
                  staged.timeframeSeconds !== 60
                    ? `Cannot merge: timeframe is ${formatTimeframe(staged.timeframeSeconds)}; live DB stores 1-minute candles only`
                    : undefined
                }
              >
                {kaggleBusy === 'merge' ? 'Merging…' : 'Merge into live DB'}
              </button>
            </div>
          </div>
        )}

        {/* BACKUP */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span className={SECTION_TITLE}>Backup</span>
            <span className="text-[11px] text-(--color-text-muted)">Auto-backup daily · last 7 kept</span>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="block text-xs text-(--color-text-medium)" style={{ marginBottom: 6 }}>
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
                className="text-sm font-medium rounded-lg bg-(--color-accent)/20 text-(--color-accent-text) hover:bg-(--color-accent)/30 transition-all disabled:opacity-50 shrink-0"
                style={{ padding: '7px 18px', whiteSpace: 'nowrap' }}
              >
                {backupLoading ? 'Saving...' : 'Save Backup'}
              </button>
            </div>
          </div>

          <button
            onClick={handleDownload}
            disabled={!hasData}
            className="text-xs text-(--color-text) hover:text-white transition-colors disabled:opacity-50"
          >
            Or download to browser →
          </button>

          {backupMsg && (
            <div
              className={`text-[11px] rounded-lg ${
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
