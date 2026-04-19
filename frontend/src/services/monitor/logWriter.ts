import type { Incident, SessionSummary } from './types';
import { metricCollector } from './metricCollector';

// ---------------------------------------------------------------------------
// IndexedDB handle persistence (same pattern as recording/directoryHandle.ts)
// ---------------------------------------------------------------------------

const DB_NAME = 'MonitorSettings';
const STORE_NAME = 'handles';
const KEY = 'logsDir';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function getReadyHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadHandle();
  if (!handle) return null;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return handle;
  const req = await handle.requestPermission({ mode: 'readwrite' });
  return req === 'granted' ? handle : null;
}

export async function pickLogsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof (window as any).showDirectoryPicker !== 'function') return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    console.error('[Monitor] pickLogsDirectory failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function dateTag(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function timeET(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Binary tick format: 12 bytes per tick
//   [timestamp 4B uint32 unix sec][bid 3B fixed-point /100][ask 3B fixed-point /100][flags 2B]
// ---------------------------------------------------------------------------

const TICK_BYTES = 12;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_TICK_COUNT = 1_000;

// ---------------------------------------------------------------------------
// LogWriter class
// ---------------------------------------------------------------------------

class LogWriter {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private tag = '';

  private sessionWritable: FileSystemWritableFileStream | null = null;
  private incidentWritable: FileSystemWritableFileStream | null = null;
  private rafWritable: FileSystemWritableFileStream | null = null;
  private pricesWritable: FileSystemWritableFileStream | null = null;

  private tickBuffer: Uint8Array[] = [];
  private incidentLineCount = 0;
  private rafSampleCount = 0;
  private totalTicks = 0;
  private rafSumMs = 0;
  private rafWorstMs = 0;

  private flushTimer = 0;
  private sessionActive = false;

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  async openSession(symbol: string, contract: string): Promise<boolean> {
    this.dirHandle = await getReadyHandle();
    if (!this.dirHandle) {
      this.dirHandle = await pickLogsDirectory();
      if (!this.dirHandle) return false;
    }

    this.tag = dateTag();
    this.tickBuffer = [];
    this.incidentLineCount = 0;
    this.rafSampleCount = 0;
    this.totalTicks = 0;
    this.rafSumMs = 0;
    this.rafWorstMs = 0;

    try {
      this.sessionWritable  = await this.openWritable(`session_${this.tag}.log`);
      this.incidentWritable = await this.openWritable(`incidents_${this.tag}.log`);
      this.rafWritable      = await this.openWritable(`raf_${this.tag}.log`);
      this.pricesWritable   = await this.openWritable(`prices_${this.tag}.bin`);
    } catch (err) {
      console.error('[Monitor] Failed to open session files:', err);
      return false;
    }

    const startTimeStr = timeET(Date.now());
    await this.sessionWritable.write(
      `SESSION  ${this.tag}  ${startTimeStr} ET\nSYMBOL   ${symbol}  CONTRACT  ${contract}\n\n`
    );

    this.flushTimer = window.setInterval(() => this.flushTicks(), FLUSH_INTERVAL_MS);
    this.sessionActive = true;
    return true;
  }

  async closeSession(incidents: Incident[]): Promise<void> {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    clearInterval(this.flushTimer);

    await this.flushTicks();

    const snap = metricCollector.getSnapshot();
    const now = Date.now();
    const durationMs = now - snap.sessionStartTime;
    const serverGaps = incidents.filter((i) => i.nodeId === 'network' && i.type === 'freeze').length;
    const appLags    = incidents.filter((i) => i.nodeId === 'adapter' || (i.nodeId === 'chart' && i.type === 'lag')).length;

    let frozenMs = 0;
    for (const inc of incidents) {
      if (inc.endTime) frozenMs += inc.endTime - inc.startTime;
    }
    const uptimePct = durationMs > 0 ? Math.max(0, (1 - frozenMs / durationMs) * 100) : 100;

    const avgRaf = this.rafSampleCount > 0 ? this.rafSumMs / this.rafSampleCount : 0;

    const streamSection = [
      `STREAM   prices_${this.tag}.bin      ticks=${this.totalTicks.toLocaleString()}`,
      `STREAM   raf_${this.tag}.log         samples=${this.rafSampleCount}  avg=${avgRaf.toFixed(0)}ms  worst=${this.rafWorstMs.toFixed(0)}ms`,
      `STREAM   incidents_${this.tag}.log   count=${incidents.length}`,
    ].join('\n');

    let incidentSection = 'INCIDENTS\n';
    if (incidents.length === 0) {
      incidentSection += '  (none)\n';
    } else {
      for (const inc of incidents) {
        const dur = inc.endTime ? ((inc.endTime - inc.startTime) / 1000).toFixed(1) + 's' : 'ongoing';
        const kind = inc.type === 'freeze' ? 'FREEZE' : 'LAG   ';
        incidentSection += `  ${timeET(snap.sessionStartTime + inc.startTime - performance.now())}  ${kind}  ${dur}  [${inc.nodeId}]\n`;
      }
    }

    const verdict = serverGaps > 0
      ? `${serverGaps} server freeze${serverGaps > 1 ? 's' : ''} detected (network node)`
      : appLags > 0
        ? `${appLags} app lag${appLags > 1 ? 's' : ''} detected (adapter/chart)`
        : 'Clean session';

    const healthSection = [
      'HEALTH',
      `  uptime        ${uptimePct.toFixed(1)}%`,
      `  server_gaps   ${serverGaps}`,
      `  app_lags      ${appLags}`,
      `  verdict       ${verdict}`,
    ].join('\n');

    const endTimeStr = timeET(now);
    const durationMin = Math.round(durationMs / 60_000);

    await this.sessionWritable?.write(
      `\n${streamSection}\n\n${incidentSection}\n${healthSection}\n\nSESSION_END  ${endTimeStr}  duration=${durationMin}min\n`
    );

    await this.sessionWritable?.close();
    await this.incidentWritable?.close();
    await this.rafWritable?.close();
    await this.pricesWritable?.close();

    await this.updateIndex({ tag: this.tag, incidentCount: incidents.length, serverGaps, appLags, verdict });
  }

  // ---------------------------------------------------------------------------
  // Per-event writes
  // ---------------------------------------------------------------------------

  writeTick(bid: number, ask: number, isGap = false) {
    if (!this.sessionActive) return;

    const buf = new Uint8Array(TICK_BYTES);
    const view = new DataView(buf.buffer);
    const ts = Math.floor(Date.now() / 1000);
    view.setUint32(0, ts, false);

    // bid/ask as 3-byte fixed-point (multiply by 100, store as 24-bit int)
    const bidFixed = Math.round(bid * 100) & 0xFFFFFF;
    const askFixed = Math.round(ask * 100) & 0xFFFFFF;
    buf[4] = (bidFixed >> 16) & 0xFF;
    buf[5] = (bidFixed >> 8)  & 0xFF;
    buf[6] =  bidFixed        & 0xFF;
    buf[7] = (askFixed >> 16) & 0xFF;
    buf[8] = (askFixed >> 8)  & 0xFF;
    buf[9] =  askFixed        & 0xFF;

    // flags: bit 0 = gap
    view.setUint16(10, isGap ? 1 : 0, false);

    this.tickBuffer.push(buf);
    this.totalTicks++;
    metricCollector.advancePriceOffset(TICK_BYTES);

    if (this.tickBuffer.length >= FLUSH_TICK_COUNT) this.flushTicks();
  }

  async writeIncident(inc: Incident): Promise<void> {
    if (!this.incidentWritable) return;
    this.incidentLineCount++;
    const lineTag = `#L${this.incidentLineCount}`;
    const kind = inc.type === 'freeze' ? 'FREEZE' : 'LAG';
    const startStr = timeET(Date.now() - performance.now() + inc.startTime);
    const endStr = inc.endTime ? timeET(Date.now() - performance.now() + inc.endTime) : 'ongoing';
    const dur = inc.endTime ? ((inc.endTime - inc.startTime) / 1000).toFixed(3) + 's' : 'ongoing';

    const text = [
      `${lineTag}`,
      `INCIDENT  ${kind}  ${startStr} → ${endStr}`,
      `  node      ${inc.nodeId}`,
      `  trigger   ${inc.trigger}`,
      `  worst     RAF lag ${inc.worstLagMs.toFixed(0)}ms`,
      `  duration  ${dur}`,
      `  prices    prices_${this.tag}.bin@offset=${inc.priceOffset}`,
      '',
    ].join('\n');

    await this.incidentWritable.write(text);
  }

  recordRafSample(ms: number) {
    if (!this.sessionActive) return;
    this.rafSampleCount++;
    this.rafSumMs += ms;
    if (ms > this.rafWorstMs) this.rafWorstMs = ms;
    // Write to raf log (text, not binary; keep lightweight)
    const ts = Math.floor(Date.now() / 1000);
    this.rafWritable?.write(`${ts} ${ms.toFixed(1)}\n`).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async flushTicks(): Promise<void> {
    if (!this.pricesWritable || this.tickBuffer.length === 0) return;
    const combined = new Uint8Array(this.tickBuffer.length * TICK_BYTES);
    let offset = 0;
    for (const chunk of this.tickBuffer) {
      combined.set(chunk, offset);
      offset += TICK_BYTES;
    }
    this.tickBuffer = [];
    await this.pricesWritable.write(combined);
  }

  private async openWritable(filename: string): Promise<FileSystemWritableFileStream> {
    const fileHandle = await this.dirHandle!.getFileHandle(filename, { create: true });
    return fileHandle.createWritable();
  }

  private async updateIndex(entry: {
    tag: string; incidentCount: number; serverGaps: number; appLags: number; verdict: string;
  }): Promise<void> {
    if (!this.dirHandle) return;
    try {
      let existing = '';
      try {
        const fh = await this.dirHandle.getFileHandle('index.log', { create: false });
        const file = await fh.getFile();
        existing = await file.text();
      } catch {
        existing = 'INDEX  TradingTerminal Monitor Logs\n\n';
      }

      const summary = entry.incidentCount === 0
        ? `${entry.tag}  session_${entry.tag}.log   incidents=0  clean`
        : `${entry.tag}  session_${entry.tag}.log   incidents=${entry.incidentCount}  verdict=${entry.verdict}`;

      const fh = await this.dirHandle.getFileHandle('index.log', { create: true });
      const w = await fh.createWritable();
      await w.write(existing.trimEnd() + '\n' + summary + '\n');
      await w.close();
    } catch (err) {
      console.error('[Monitor] Failed to update index.log:', err);
    }
  }
}

export const logWriter = new LogWriter();
