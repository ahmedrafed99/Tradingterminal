/**
 * File-backed debug logger.
 *
 * Usage:
 *   debugLog.log('tag', { any: 'data' })
 *
 * Sends buffered lines to the backend every 2 s; backend writes to
 * project-root/log/debug-YYYY-MM-DD.log automatically.
 * Ctrl+Shift+L downloads the in-memory buffer as a fallback.
 */

const FLUSH_MS  = 2_000;
const MAX_LINES = 20_000;
const LOG_URL   = 'http://localhost:3001/log';

class DebugLog {
  private _enabled = false;
  private buffer:  string[] = [];
  private timer    = 0;

  enable() {
    if (this._enabled) return;
    this._enabled = true;
    this.buffer.push(this.stamp('--- DebugLog enabled ---'));
    this.startTimer();
  }

  disable() {
    this._enabled = false;
    clearInterval(this.timer);
    this.timer = 0;
  }

  get enabled() { return this._enabled; }

  log(msg: string, data?: unknown) {
    if (!this._enabled) return;
    const line = data !== undefined
      ? `${this.stamp(msg)}  ${JSON.stringify(data, null, 0)}`
      : this.stamp(msg);
    this.buffer.push(line);
    if (this.buffer.length > MAX_LINES) this.buffer.shift();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.splice(0);
    try {
      await fetch(LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
    } catch {
      // Backend unavailable — put lines back so they're not lost
      this.buffer.unshift(...lines);
    }
  }

  download(filename = `debug-${Date.now()}.txt`) {
    const blob = new Blob([this.buffer.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  private stamp(msg: string): string {
    return `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      if (this.buffer.length > 0) this.flush();
    }, FLUSH_MS);
  }
}

export const debugLog = new DebugLog();

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') debugLog.download();
  });
}