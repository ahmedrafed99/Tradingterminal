import * as fs from 'fs/promises';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');

let cache: Set<string> | null = null;

function rootSymbol(name: string): string {
  return name.replace(/[A-Z]\d+$/i, '').toUpperCase();
}

async function load(): Promise<Set<string>> {
  if (cache !== null) return cache;
  try {
    const raw = await fs.readFile(BLACKLIST_FILE, 'utf-8');
    cache = new Set(JSON.parse(raw) as string[]);
  } catch {
    cache = new Set();
  }
  return cache;
}

export async function getBlacklist(): Promise<string[]> {
  return [...(await load())];
}

export async function saveBlacklist(symbols: string[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BLACKLIST_FILE, JSON.stringify(symbols), 'utf-8');
  cache = new Set(symbols);
}

/** Check by contract name (e.g. "NQH5" → root "NQ") */
export async function isBlacklisted(contractName: string): Promise<boolean> {
  const symbols = await load();
  return symbols.has(rootSymbol(contractName));
}
