import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate';
import { isConnected } from '../adapters/registry';
import * as databaseService from '../services/databaseService';
import * as backfillService from '../services/backfillService';

const router = Router();

// ---------------------------------------------------------------------------
// Kaggle helper: spawn a venv python script and parse its single-line JSON
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const KAGGLE_PYTHON = path.join(PROJECT_ROOT, 'scripts', 'venv', 'Scripts', 'python.exe');
const KAGGLE_STATUS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'kaggle_status.py');
const KAGGLE_RESTORE_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'restore_from_kaggle.py');
const KAGGLE_BACKUP_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'backup_to_kaggle.py');

function runKaggleScript(scriptPath: string, args: string[] = []): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    if (!fs.existsSync(KAGGLE_PYTHON)) {
      resolve({ ok: false, error: 'Python venv not found. Run: python -m venv scripts/venv && scripts/venv/Scripts/pip install -r scripts/requirements.txt' });
      return;
    }
    const proc = spawn(KAGGLE_PYTHON, [scriptPath, ...args]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
    proc.on('close', () => {
      const lastLine = stdout.trim().split(/\r?\n/).pop() || '';
      try {
        const parsed = JSON.parse(lastLine);
        resolve({ ok: true, data: parsed });
      } catch {
        resolve({ ok: false, error: stderr.trim() || stdout.trim() || 'Kaggle script returned no JSON output' });
      }
    });
  });
}

// Guard: must be connected for fetch operations
function requireConnection(
  _req: unknown,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (!isConnected()) {
    res.status(401).json({ success: false, errorMessage: 'Not connected' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /database/status
// ---------------------------------------------------------------------------

router.get('/status', (_req, res) => {
  const status = databaseService.getStatus();
  res.json(status);
});

// ---------------------------------------------------------------------------
// POST /database/fetch
// ---------------------------------------------------------------------------

const fetchSchema = z.object({
  contractId: z.string().min(1),
  mode: z.enum(['sync', 'range']),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

router.post(
  '/fetch',
  requireConnection,
  validateBody(fetchSchema),
  async (req, res) => {
    try {
      const result = await backfillService.startFetch(req.body);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ success: false, errorMessage: msg });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /database/fetch/sync-all — trigger immediate sync of all stored symbols
// ---------------------------------------------------------------------------

router.post('/fetch/sync-all', requireConnection, async (_req, res) => {
  try {
    backfillService.autoSyncAll().catch((err) => {
      console.error('[sync-all] Failed:', err instanceof Error ? err.message : err);
    });
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /database/fetch/progress
// ---------------------------------------------------------------------------

router.get('/fetch/progress', (_req, res) => {
  res.json(backfillService.getProgress());
});

// ---------------------------------------------------------------------------
// POST /database/fetch/cancel
// ---------------------------------------------------------------------------

router.post('/fetch/cancel', (_req, res) => {
  const cancelled = backfillService.cancel();
  res.json({ cancelled });
});

// ---------------------------------------------------------------------------
// GET /database/candles
// ---------------------------------------------------------------------------

const candlesQuerySchema = z.object({
  contractId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  timeframe: z.string().optional().default('1m'),
});

router.get('/candles', validateQuery(candlesQuerySchema), (req, res) => {
  try {
    const { contractId, from, to, timeframe } = req.query as {
      contractId: string;
      from: string;
      to: string;
      timeframe: string;
    };

    const fromEpoch = Math.floor(new Date(from).getTime() / 1000);
    const toEpoch = Math.floor(new Date(to).getTime() / 1000);

    const candles = databaseService.getAggregatedCandles(
      contractId,
      fromEpoch,
      toEpoch,
      timeframe,
    );

    res.json({ candles, count: candles.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// DELETE /database/contracts/:id
// ---------------------------------------------------------------------------

router.delete('/contracts/:id', (req, res) => {
  const deleted = databaseService.deleteContract(req.params.id);
  res.json({ deleted });
});

// ---------------------------------------------------------------------------
// POST /database/backup — manual backup to a user-chosen directory
// ---------------------------------------------------------------------------

const backupSchema = z.object({
  directory: z.string().optional(), // if omitted, uses default backup dir
});

router.post('/backup', validateBody(backupSchema), async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `candles-${date}.db`;

    let dir = req.body.directory?.trim();
    if (dir) {
      // Expand ~ to home dir
      if (dir.startsWith('~')) dir = path.join(os.homedir(), dir.slice(1));
      // Validate directory exists
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        res.status(400).json({ success: false, errorMessage: 'Directory does not exist' });
        return;
      }
    } else {
      dir = databaseService.getBackupDir();
      fs.mkdirSync(dir, { recursive: true });
    }

    const destPath = path.join(dir, filename);
    await databaseService.backup(destPath);

    res.json({ success: true, path: destPath, filename });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /database/backup/download — stream the db file as a download
// ---------------------------------------------------------------------------

router.get('/backup/download', async (_req, res) => {
  try {
    const tmpDir = os.tmpdir();
    const filename = `candles-${new Date().toISOString().slice(0, 10)}.db`;
    const tmpPath = path.join(tmpDir, filename);
    await databaseService.backup(tmpPath);

    res.download(tmpPath, filename, (err) => {
      // Clean up temp file
      fs.unlink(tmpPath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ success: false, errorMessage: 'Download failed' });
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, errorMessage: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /database/backups — list existing backups
// ---------------------------------------------------------------------------

router.get('/backups', (_req, res) => {
  const dir = databaseService.getBackupDir();
  if (!fs.existsSync(dir)) {
    res.json({ backups: [] });
    return;
  }

  const backups = fs.readdirSync(dir)
    .filter((f) => f.startsWith('candles-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { filename: f, sizeBytes: stat.size, created: stat.mtime.toISOString() };
    });

  res.json({ backups });
});

// ---------------------------------------------------------------------------
// GET /database/kaggle/status — compare Kaggle dataset vs local DB
// ---------------------------------------------------------------------------

router.get('/kaggle/status', async (_req, res) => {
  const dbPath = databaseService.getDbPath();
  let localUpdated: string | null = null;
  let localSizeBytes = 0;
  try {
    const stat = fs.statSync(dbPath);
    localUpdated = stat.mtime.toISOString();
    localSizeBytes = stat.size;
  } catch {
    // Local DB doesn't exist yet — Kaggle is trivially ahead.
  }

  // "Empty" = no candles stored. File mtime gets bumped by SQLite housekeeping
  // (WAL setup on startup, etc.) even with zero data, so we can't trust mtime
  // alone to decide which side is ahead.
  const localHasData = databaseService.getStatus().contracts.length > 0;

  const result = await runKaggleScript(KAGGLE_STATUS_SCRIPT);

  if (!result.ok) {
    res.json({
      success: false,
      errorMessage: result.error,
      local: { lastUpdated: localUpdated, sizeBytes: localSizeBytes, hasData: localHasData },
    });
    return;
  }

  const data = result.data as {
    ok: boolean;
    error?: string;
    datasetId?: string;
    lastUpdated?: string;
    sizeBytes?: number;
  };

  if (!data.ok) {
    res.json({
      success: false,
      errorMessage: data.error,
      local: { lastUpdated: localUpdated, sizeBytes: localSizeBytes, hasData: localHasData },
    });
    return;
  }

  // Compare timestamps. Kaggle format: "2026-05-19 14:08:00.193000" (UTC).
  const kaggleDate = new Date((data.lastUpdated || '').replace(' ', 'T') + 'Z');
  const localDate = localUpdated ? new Date(localUpdated) : null;
  const kaggleAheadByMs = localDate
    ? kaggleDate.getTime() - localDate.getTime()
    : Number.POSITIVE_INFINITY;

  // If local has no data, Kaggle is unconditionally "ahead" regardless of mtime.
  // "Local ahead" only makes sense when local actually has data to push.
  const isKaggleAhead = !localHasData || kaggleAheadByMs > 60_000;
  const isLocalAhead = localHasData && kaggleAheadByMs < -60_000;

  res.json({
    success: true,
    kaggle: {
      datasetId: data.datasetId,
      lastUpdated: kaggleDate.toISOString(),
      sizeBytes: data.sizeBytes ?? 0,
    },
    local: {
      lastUpdated: localUpdated,
      sizeBytes: localSizeBytes,
      hasData: localHasData,
    },
    isKaggleAhead,
    isLocalAhead,
  });
});

// ---------------------------------------------------------------------------
// POST /database/kaggle/pull — download Kaggle dataset into a staging file.
// Does NOT touch the live DB. Caller must then call /kaggle/merge to apply,
// or /kaggle/discard to drop the staged file.
// ---------------------------------------------------------------------------

router.post('/kaggle/pull', async (_req, res) => {
  const stagingDir = databaseService.getStagingDir();
  const stagedPath = databaseService.getStagingDbPath();
  fs.mkdirSync(stagingDir, { recursive: true });

  // Always start from a clean slate — replace any prior staged file.
  if (fs.existsSync(stagedPath)) {
    try { fs.unlinkSync(stagedPath); } catch { /* ignore */ }
  }

  const result = await runKaggleScript(KAGGLE_RESTORE_SCRIPT, [stagedPath]);

  if (!result.ok) {
    res.status(500).json({ success: false, errorMessage: result.error });
    return;
  }

  const data = result.data as { ok: boolean; error?: string; path?: string; sizeBytes?: number };
  if (!data.ok) {
    res.status(500).json({ success: false, errorMessage: data.error });
    return;
  }

  const validation = databaseService.inspectStaged();
  res.json({
    success: true,
    staged: validation.summary ?? null,
    validationError: validation.valid ? null : validation.error,
  });
});

// ---------------------------------------------------------------------------
// GET /database/kaggle/staged — describe currently staged file (if any)
// ---------------------------------------------------------------------------

router.get('/kaggle/staged', (_req, res) => {
  const validation = databaseService.inspectStaged();
  if (!validation.valid && validation.error === 'No staged file') {
    res.json({ success: true, staged: null });
    return;
  }
  res.json({
    success: validation.valid,
    staged: validation.summary ?? null,
    validationError: validation.valid ? null : validation.error,
  });
});

// ---------------------------------------------------------------------------
// POST /database/kaggle/merge — strict-safe merge of staged file into live DB
// ---------------------------------------------------------------------------

router.post('/kaggle/merge', (_req, res) => {
  const validation = databaseService.inspectStaged();
  if (!validation.valid || !validation.summary) {
    res.status(400).json({
      success: false,
      errorMessage: validation.error || 'No staged file to merge',
    });
    return;
  }

  const liveTf = databaseService.liveTimeframeSeconds();
  const stagedTf = validation.summary.timeframeSeconds;
  if (stagedTf !== liveTf) {
    res.status(400).json({
      success: false,
      errorMessage:
        `Timeframe mismatch: staged data is ${databaseService.describeTimeframe(stagedTf)} ` +
        `but the live DB only stores ${databaseService.describeTimeframe(liveTf)} candles. ` +
        `Merge refused.`,
      stagedTimeframeSeconds: stagedTf,
      liveTimeframeSeconds: liveTf,
    });
    return;
  }

  const overlaps = databaseService.detectStagedOverlap(validation.summary.path);
  if (overlaps.length > 0) {
    res.status(409).json({
      success: false,
      errorMessage:
        'Merge refused: staged data overlaps with existing rows. ' +
        'No rows were merged.',
      overlaps,
    });
    return;
  }

  try {
    const { merged } = databaseService.mergeStaged(validation.summary.path);
    databaseService.discardStaged(); // auto-delete on successful merge
    res.json({ success: true, merged });
  } catch (err) {
    res.status(500).json({
      success: false,
      errorMessage: err instanceof Error ? err.message : 'Merge failed',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /database/kaggle/discard — remove the staged file without merging
// ---------------------------------------------------------------------------

router.post('/kaggle/discard', (_req, res) => {
  const removed = databaseService.discardStaged();
  res.json({ success: true, removed });
});

// ---------------------------------------------------------------------------
// POST /database/kaggle/push — push current DB to Kaggle as a new version
// ---------------------------------------------------------------------------

router.post('/kaggle/push', async (_req, res) => {
  const { contracts } = databaseService.getStatus();
  if (contracts.length === 0) {
    res.status(400).json({ success: false, errorMessage: 'Local DB is empty — nothing to push' });
    return;
  }

  const result = await runKaggleScript(KAGGLE_BACKUP_SCRIPT);
  if (!result.ok) {
    res.status(500).json({ success: false, errorMessage: result.error });
    return;
  }
  res.json({ success: true });
});

export default router;
