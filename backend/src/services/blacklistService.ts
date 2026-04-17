import * as fs from 'fs/promises';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../../data');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');

export interface BlacklistData {
  global: string[];
  accounts: Record<string, string[]>;
}

let cache: BlacklistData | null = null;

function rootSymbol(name: string): string {
  return name.replace(/[A-Z]\d+$/i, '').toUpperCase();
}

async function load(): Promise<BlacklistData> {
  if (cache !== null) return cache;
  try {
    const raw = await fs.readFile(BLACKLIST_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // migrate old format (plain array) to new format
    if (Array.isArray(parsed)) {
      cache = { global: parsed, accounts: {} };
    } else {
      cache = { global: parsed.global ?? [], accounts: parsed.accounts ?? {} };
    }
  } catch {
    cache = { global: [], accounts: {} };
  }
  return cache;
}

export async function getBlacklist(): Promise<BlacklistData> {
  return load();
}

export async function saveBlacklist(data: BlacklistData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BLACKLIST_FILE, JSON.stringify(data), 'utf-8');
  cache = data;
}

/** Check by contract name (e.g. "NQH5" → root "NQ") and optional accountId */
export async function isBlacklisted(contractName: string, accountId?: string): Promise<boolean> {
  const data = await load();
  const root = rootSymbol(contractName);
  if (data.global.includes(root)) return true;
  if (accountId && data.accounts[accountId]?.includes(root)) return true;
  return false;
}
