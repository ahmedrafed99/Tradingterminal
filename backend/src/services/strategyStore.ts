import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STORE_FILE = path.resolve(process.cwd(), 'data', 'strategies.json');

export interface StoredProfile {
  id: string;
  name: string;
  description: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

/** Strategy type ids that have a registered implementation. */
export const AVAILABLE_TYPES = ['ml-nq'] as const;
export type StrategyType = typeof AVAILABLE_TYPES[number];

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function read(): StoredProfile[] {
  if (!fs.existsSync(STORE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) as StoredProfile[];
  } catch {
    return [];
  }
}

function write(profiles: StoredProfile[]): void {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Seed defaults the first time
// ---------------------------------------------------------------------------

export function ensureDefaults(): void {
  if (fs.existsSync(STORE_FILE)) return;
  const now = new Date().toISOString();
  write([
    {
      id: 'ml-nq',
      name: 'ML NQ',
      description: 'Machine learning signal-based live trading on NQ via Python ML server',
      type: 'ml-nq',
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export function loadProfiles(): StoredProfile[] {
  return read();
}

export function createProfile(
  name: string,
  type: StrategyType,
  description = '',
): StoredProfile {
  const profiles = read();
  const now = new Date().toISOString();
  const profile: StoredProfile = {
    id: crypto.randomUUID(),
    name,
    description,
    type,
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  write(profiles);
  return profile;
}

export function updateProfile(
  id: string,
  updates: Partial<Pick<StoredProfile, 'name' | 'description'>>,
): StoredProfile | null {
  const profiles = read();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = { ...profiles[idx], ...updates, updatedAt: new Date().toISOString() };
  write(profiles);
  return profiles[idx];
}

export function deleteProfile(id: string): boolean {
  const profiles = read();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  profiles.splice(idx, 1);
  write(profiles);
  return true;
}