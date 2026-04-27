/**
 * File-backed debug logger.
 *
 * Usage:
 *   debugLog.log('tag', { any: 'data' })
 *
 * Writes to debug-YYYY-MM-DD.log in the configured logs directory.
 * Reuses the same directory as the monitor log writer (MonitorSettings/logsDir).
 * First-time setup: call debugLog.pickDirectory() once, then it's automatic.
 * Ctrl+Shift+L downloads the in-memory buffer as a fallback.
 */

// ── IndexedDB (shared with logWriter.ts) ────────────────

const DB_NAME   = 'MonitorSettings';
const STORE     = 'handles';
const DIR_KEY   = 'logsDir';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(DIR_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function saveDirHandle(h: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(h, DIR_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function getGrantedHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h = await loadDirHandle();
  if (!h) return null;
  const perm = await (h as any).queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return h;
  return (await (h as any).requestPermission({ mode: 'readwrite' })) === 'granted' ? h : null;
}

// ── Logger ───────────────────────────────────────────────

const FLUSH_MS  = 2_000;
const MAX_LINES = 20_000;

class DebugLog {
  private _enabled  = false;
  private buffer:   string[] = [];
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private timer     = 0;

  // ── Public API ──────────────────────────────────────

  /** Enable logging and auto-connect to the stored logs directory. */
  enable() {
    if (this._enabled) return;
    this._enabled = true;
    this.buffer.push(this.stamp('--- DebugLog enabled ---'));
    this.initDir();
    this.startTimer();
  }

  disable() {
    this._enabled = false;
    clearInterval(this.timer);
    this.timer = 0;
  }

  get enabled() { return this._enabled; }

  /** Write a log line. No-op when disabled. */
  log(msg: string, data?: unknown) {
    if (!this._enabled) return;
    const line = data !== undefined
      ? `${this.stamp(msg)}  ${JSON.stringify(data, null, 0)}`
      : this.stamp(msg);
    this.buffer.push(line);
    if (this.buffer.length > MAX_LINES) this.buffer.shift();
  }

  /**
   * Pick a logs directory (prompts the browser once).
   * Persisted in IndexedDB — shared with the monitor log writer.
   */
  async pickDirectory(): Promise<boolean> {
    if (typeof (window as any).showDirectoryPicker !== 'function') return false;
    try {
      const h = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await saveDirHandle(h);
      this.dirHandle = h;
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      return false;
    }
  }

  /** Force-flush buffered lines to disk right now. */
  async flush(): Promise<void> {
    if (!this.dirHandle || this.buffer.length === 0) return;
    const lines = this.buffer.splice(0);
    await this.appendToFile(lines);
  }

  /** Download buffer as a text file (fallback when no directory is set). */
  download(filename = `debug-${Date.now()}.txt`) {
    const blob = new Blob([this.buffer.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Internals ────────────────────────────────────────

  private stamp(msg: string): string {
    return `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  }

  private async initDir() {
    this.dirHandle = await getGrantedHandle();
    if (!this.dirHandle) {
      // No directory configured yet — buffer in memory, Ctrl+Shift+L still works
      console.info('[DebugLog] No logs directory set. Call debugLog.pickDirectory() once to enable file logging.');
    }
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      if (this.buffer.length > 0) this.flush();
    }, FLUSH_MS);
  }

  private async appendToFile(lines: string[]): Promise<void> {
    if (!this.dirHandle) return;
    const date     = new Date().toISOString().slice(0, 10);
    const filename = `debug-${date}.log`;
    try {
      const fh       = await this.dirHandle.getFileHandle(filename, { create: true });
      const file     = await fh.getFile();
      const writable = await fh.createWritable({ keepExistingData: true });
      await writable.seek(file.size);
      await writable.write(lines.join('\n') + '\n');
      await writable.close();
    } catch {
      // Put lines back so they're not lost
      this.buffer.unshift(...lines);
    }
  }
}

export const debugLog = new DebugLog();

if (typeof window !== 'undefined') {
  // Ctrl+Shift+L → download fallback
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') debugLog.download();
  });
  // Expose on window in dev so browser console can call debugLog.pickDirectory()
  if (import.meta.env.DEV) {
    (window as any).debugLog = debugLog;
  }
}
