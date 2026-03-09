import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import {
  databaseService,
  type DatabaseStatus,
  type FetchProgress,
} from '../../services/databaseService';

const POLL_INTERVAL = 1500;

export function DatabaseTab() {
  const { contract, secondContract, orderContract } = useStore();

  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [selectedContract, setSelectedContract] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backupDir, setBackupDir] = useState('');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Available contracts from the app
  const contracts = [contract, secondContract, orderContract].filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  const uniqueContracts = contracts.filter(
    (c, i, arr) => arr.findIndex((x) => x.id === c.id) === i,
  );

  useEffect(() => {
    if (!selectedContract && uniqueContracts.length > 0) {
      setSelectedContract(uniqueContracts[0].id);
    }
  }, [uniqueContracts, selectedContract]);

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
    if (!selectedContract) return;
    setError(null);
    setLoading(true);
    try {
      await databaseService.startFetch({ contractId: selectedContract, mode: 'sync' });
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

  async function handleFetch() {
    if (!selectedContract || !startDate || !endDate) return;
    setError(null);
    setLoading(true);
    try {
      await databaseService.startFetch({
        contractId: selectedContract,
        mode: 'range',
        startTime: new Date(startDate).toISOString(),
        endTime: new Date(endDate).toISOString(),
      });
      startPolling();
      setProgress({
        jobId: '', status: 'running', pagesCompleted: 0, pagesTotal: 1,
        barsInserted: 0, currentTimestamp: null, errorMessage: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start fetch');
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

  const hasExistingData = status?.contracts?.some(
    (c) => c.contractId === selectedContract,
  ) ?? false;

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

  const selectedName = uniqueContracts.find((c) => c.id === selectedContract)?.name;

  return (
    <div style={{ padding: '20px 32px 24px' }}>
      {/* STATUS SECTION */}
      <div style={{ marginBottom: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span className="text-[10px] uppercase tracking-wider text-[#787b86]">
            Stored Data
          </span>
          <span className="text-[10px] text-[#434651]">
            {formatBytes(status?.dbSizeBytes ?? 0)}
          </span>
        </div>

        {status?.contracts?.length ? (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2e39' }}>
            {status.contracts.map((c, i) => (
              <div
                key={c.contractId}
                className="flex items-center justify-between hover:bg-[#1e222d] transition-colors"
                style={{
                  padding: '10px 12px',
                  borderTop: i > 0 ? '1px solid #2a2e39' : undefined,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="text-xs text-[#d1d4dc]" style={{ marginBottom: 2 }}>
                    {c.contractId}
                  </div>
                  <div className="text-[10px] text-[#787b86]">
                    {formatDate(c.oldestBar)} — {formatDate(c.newestBar)}
                    <span className="text-[#434651]"> · </span>
                    {formatNumber(c.totalBars)} bars
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(c.contractId)}
                  disabled={isFetching}
                  className="text-[#434651] hover:text-red-400 transition-colors disabled:opacity-50"
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
            className="text-xs text-[#434651] text-center rounded-lg"
            style={{ padding: '16px 12px', border: '1px solid #2a2e39' }}
          >
            No data stored yet — use Custom Fetch below to get started
          </div>
        )}
      </div>

      {/* DIVIDER */}
      <div style={{ borderTop: '1px solid #2a2e39', marginBottom: 20 }} />

      {/* FETCH CONTROLS */}
      <div>
        <span className="text-[10px] uppercase tracking-wider text-[#787b86]" style={{ display: 'block', marginBottom: 10 }}>
          Fetch Data
        </span>

        {/* Contract selector */}
        <div style={{ marginBottom: 14 }}>
          <span className="text-[10px] text-[#787b86]" style={{ display: 'block', marginBottom: 4 }}>
            Contract
          </span>
          <select
            value={selectedContract}
            onChange={(e) => setSelectedContract(e.target.value)}
            disabled={isFetching}
            className="w-full bg-[#111] text-xs text-[#d1d4dc] rounded-lg focus:outline-none focus:border-[#2962ff] disabled:opacity-50"
            style={{
              padding: '8px 12px',
              border: '1px solid #2a2e39',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23787b86' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: 32,
            }}
          >
            {uniqueContracts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {uniqueContracts.length === 0 && (
              <option value="">No contracts loaded</option>
            )}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-end" style={{ gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <span className="text-[10px] text-[#787b86]" style={{ display: 'block', marginBottom: 4 }}>
              From
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isFetching}
              className="w-full bg-[#111] text-xs text-[#d1d4dc] rounded-lg focus:outline-none focus:border-[#2962ff] disabled:opacity-50"
              style={{ padding: '8px 12px', border: '1px solid #2a2e39', colorScheme: 'dark' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <span className="text-[10px] text-[#787b86]" style={{ display: 'block', marginBottom: 4 }}>
              To
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isFetching}
              className="w-full bg-[#111] text-xs text-[#d1d4dc] rounded-lg focus:outline-none focus:border-[#2962ff] disabled:opacity-50"
              style={{ padding: '8px 12px', border: '1px solid #2a2e39', colorScheme: 'dark' }}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            onClick={handleFetch}
            disabled={isFetching || loading || !selectedContract || !startDate || !endDate}
            className="text-[11px] font-medium rounded-lg bg-[#2962ff] text-white hover:bg-[#1e4fcc] transition-colors disabled:opacity-50"
            style={{ padding: '7px 16px' }}
          >
            Fetch Range
          </button>
          <button
            onClick={handleSync}
            disabled={isFetching || loading || !selectedContract || !hasExistingData}
            className="text-[11px] font-medium rounded-lg text-[#d1d4dc] hover:bg-[#363a45] transition-colors disabled:opacity-50"
            style={{ padding: '7px 16px', border: '1px solid #2a2e39' }}
          >
            Sync to Latest
          </button>
          {!hasExistingData && selectedContract && (
            <span className="text-[10px] text-[#434651]">
              Fetch first to enable sync
            </span>
          )}
        </div>
      </div>

      {/* PROGRESS */}
      {progress && (
        <div style={{ marginTop: 20 }}>
          <div style={{ borderTop: '1px solid #2a2e39', marginBottom: 16 }} />

          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[10px] uppercase tracking-wider text-[#787b86]">
              Progress
            </span>
            <span className="text-[10px]">
              {progress.status === 'running' && (
                <span className="text-[#787b86]">Fetching{selectedName ? ` ${selectedName}` : ''}…</span>
              )}
              {progress.status === 'completed' && (
                <span className="text-[#26a69a]">Completed</span>
              )}
              {progress.status === 'failed' && (
                <span className="text-[#ef5350]">Failed</span>
              )}
              {progress.status === 'cancelled' && (
                <span className="text-[#f0a830]">Cancelled</span>
              )}
            </span>
          </div>

          {/* Bar */}
          <div
            className="w-full overflow-hidden rounded-full"
            style={{ height: 4, backgroundColor: '#111', marginBottom: 8 }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress.pagesTotal > 0 ? (progress.pagesCompleted / progress.pagesTotal) * 100 : 0}%`,
                backgroundColor:
                  progress.status === 'completed' ? '#26a69a' :
                  progress.status === 'failed' ? '#ef5350' :
                  progress.status === 'cancelled' ? '#f0a830' : '#2962ff',
              }}
            />
          </div>

          <div className="flex items-center justify-between" style={{ marginBottom: progress.status === 'running' ? 10 : 0 }}>
            <span className="text-[10px] text-[#787b86]">
              {progress.pagesCompleted} / {progress.pagesTotal} pages
            </span>
            {progress.barsInserted > 0 && (
              <span className="text-[10px] text-[#787b86]">
                {formatNumber(progress.barsInserted)} bars inserted
              </span>
            )}
          </div>

          {progress.status === 'failed' && progress.errorMessage && (
            <div className="text-[10px] text-[#ef5350]" style={{ marginTop: 4 }}>
              {progress.errorMessage}
            </div>
          )}

          {progress.status === 'running' && (
            <button
              onClick={handleCancel}
              className="text-[10px] text-[#787b86] hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* BACKUP */}
      <div style={{ marginTop: 20 }}>
        <div style={{ borderTop: '1px solid #2a2e39', marginBottom: 16 }} />

        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span className="text-[10px] uppercase tracking-wider text-[#787b86]">
            Backup
          </span>
          <span className="text-[10px] text-[#434651]">
            Auto-backup daily · last 7 kept
          </span>
        </div>

        {/* Save to directory */}
        <div style={{ marginBottom: 10 }}>
          <span className="text-[10px] text-[#787b86]" style={{ display: 'block', marginBottom: 4 }}>
            Save to directory (leave empty for default)
          </span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <input
              type="text"
              value={backupDir}
              onChange={(e) => setBackupDir(e.target.value)}
              placeholder="C:\Users\Ahmed\Backups"
              className="flex-1 bg-[#111] text-xs text-[#d1d4dc] rounded-lg focus:outline-none focus:border-[#2962ff] disabled:opacity-50"
              style={{ padding: '8px 12px', border: '1px solid #2a2e39' }}
            />
            <button
              onClick={handleBackup}
              disabled={backupLoading || !(status?.contracts?.length)}
              className="text-[11px] font-medium rounded-lg bg-[#2962ff] text-white hover:bg-[#1e4fcc] transition-colors disabled:opacity-50"
              style={{ padding: '7px 16px', whiteSpace: 'nowrap' }}
            >
              {backupLoading ? 'Saving…' : 'Save Backup'}
            </button>
          </div>
        </div>

        {/* Download link */}
        <button
          onClick={handleDownload}
          disabled={!(status?.contracts?.length)}
          className="text-[11px] text-[#787b86] hover:text-[#d1d4dc] transition-colors disabled:opacity-50"
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
              color: backupMsg.startsWith('Saved') ? '#26a69a' : '#ef5350',
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
