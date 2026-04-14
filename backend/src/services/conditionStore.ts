import fs from 'fs';
import path from 'path';
import type { Condition, CreateConditionInput, PatchConditionInput } from '../types/condition';

// ---------------------------------------------------------------------------
// Persistence paths
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'conditions.json');

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let conditions: Condition[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFromDisk(): void {
  ensureDataDir();
  if (!fs.existsSync(FILE)) {
    conditions = [];
    return;
  }
  try {
    const raw = fs.readFileSync(FILE, 'utf-8');
    conditions = JSON.parse(raw) as Condition[];
  } catch {
    console.warn('[conditionStore] corrupt conditions.json — starting empty');
    conditions = [];
  }
}

function scheduleSave(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(conditions, null, 2));
    writeTimer = null;
  }, DEBOUNCE_MS);
}

/** Force an immediate write (call on shutdown). */
export function flushSync(): void {
  if (writeTimer) clearTimeout(writeTimer);
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(conditions, null, 2));
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let counter = 0;
function nextId(): string {
  counter++;
  return `cond_${Date.now()}_${counter}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAll(): Condition[] {
  return conditions;
}

export function getById(id: string): Condition | undefined {
  return conditions.find((c) => c.id === id);
}

export function getArmed(): Condition[] {
  return conditions.filter((c) => c.status === 'armed');
}

export function create(input: CreateConditionInput): Condition {
  const now = new Date().toISOString();
  const condition: Condition = {
    ...input,
    id: nextId(),
    status: 'armed',
    createdAt: now,
    updatedAt: now,
  };
  conditions.push(condition);
  scheduleSave();
  return condition;
}

export function update(id: string, patch: PatchConditionInput): Condition | null {
  const idx = conditions.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  conditions[idx] = {
    ...conditions[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  scheduleSave();
  return conditions[idx];
}

export function setStatus(
  id: string,
  status: Condition['status'],
  extra?: Partial<Pick<Condition, 'triggeredAt' | 'triggeredOrderId' | 'errorMessage'>>,
): Condition | null {
  const idx = conditions.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  conditions[idx] = {
    ...conditions[idx],
    status,
    ...extra,
    updatedAt: new Date().toISOString(),
  };
  scheduleSave();
  return conditions[idx];
}

export function remove(id: string): boolean {
  const before = conditions.length;
  conditions = conditions.filter((c) => c.id !== id);
  if (conditions.length < before) {
    scheduleSave();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadFromDisk();
