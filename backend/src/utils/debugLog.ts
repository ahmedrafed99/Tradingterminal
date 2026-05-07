import fs from 'fs';
import path from 'path';

// Anchored to __dirname so it's CWD-independent: backend/src/utils → ../../../log = project-root/log
const LOG_DIR = path.resolve(__dirname, '../../..', 'log');
let dirReady = false;

function ensureDir(): void {
  if (dirReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  dirReady = true;
}

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `debug-${date}.log`);
}

function write(tag: string, data?: unknown): void {
  try {
    ensureDir();
    const ts   = new Date().toISOString().slice(11, 23);
    const body = data !== undefined ? `  ${JSON.stringify(data)}` : '';
    fs.appendFile(logFilePath(), `${ts}  [${tag}]${body}\n`, () => {});
  } catch { /* never crash the caller */ }
}

export const debugLog = { log: write };
