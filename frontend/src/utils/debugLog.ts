/**
 * Lightweight in-memory debug logger. Buffers lines, writes to a file on flush.
 * Press Ctrl+Shift+L to download the log, or call debugLog.download() in code.
 * Call debugLog.enable() to start capturing; disabled by default.
 */

const MAX_LINES = 10_000;

class DebugLog {
  private lines: string[] = [];
  private _enabled = false;

  enable() { this._enabled = true; this.log('--- DebugLog enabled ---'); }
  disable() { this._enabled = false; }
  get enabled() { return this._enabled; }

  log(msg: string, data?: unknown) {
    if (!this._enabled) return;
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const line = data !== undefined
      ? `${ts}  ${msg}  ${JSON.stringify(data, null, 0)}`
      : `${ts}  ${msg}`;
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.shift();
  }

  clear() { this.lines = []; }

  download(filename = `chart-debug-${Date.now()}.txt`) {
    const text = this.lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const debugLog = new DebugLog();

// Ctrl+Shift+L → download
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      debugLog.download();
    }
  });
}
