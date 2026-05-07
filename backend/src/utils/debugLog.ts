import fs from 'fs';
import path from 'path';

// Writes to <project-root>/log/debug-YYYY-MM-DD.log — same dir as frontend debugLog
const LOG_DIR = path.resolve(process.cwd(), '..', 'log');

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `debug-${date}.log`);
}

function write(tag: string, data?: unknown): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts   = new Date().toISOString().slice(11, 23);
    const body = data !== undefined ? `  ${JSON.stringify(data)}` : '';
    fs.appendFileSync(logFilePath(), `${ts}  [${tag}]${body}\n`);
  } catch { /* never crash the caller */ }
}

export const debugLog = { log: write };
