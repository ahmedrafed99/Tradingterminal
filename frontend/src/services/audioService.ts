/**
 * Audio notification service for order fill events.
 * Supports multiple voice-line clips per sound category, cycling sequentially.
 *
 * Clips are stored in IndexedDB (user-uploaded) with static defaults as fallback.
 * Default files live at /sounds/{category}/1.mp3
 */

const STORAGE_KEY = 'sound-settings';
const DB_NAME = 'voice-lines';
const DB_VERSION = 1;
const STORE_NAME = 'clips';

export type SoundName = 'order_filled' | 'target_filled' | 'stop_filled' | 'position_closed';
export const SOUND_NAMES: SoundName[] = ['order_filled', 'target_filled', 'stop_filled', 'position_closed'];

export interface ClipRecord {
  id?: number;
  category: SoundName;
  name: string;
  blob: Blob;
}

interface SoundSettings {
  enabled: boolean;
  volume: number; // 0–1
  rotate: Record<string, boolean>; // per-category rotation toggle
  clipOrder: Record<string, string[]>; // per-category ordered keys (id or 'default')
}

const DEFAULT_SETTINGS: SoundSettings = { enabled: true, volume: 0.8, rotate: {}, clipOrder: {} };

// ── IndexedDB helpers ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('category', 'category', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllClips(category: SoundName): Promise<ClipRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('category');
    const req = index.getAll(category);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addClip(record: ClipRecord): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

async function deleteClip(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── AudioService ───────────────────────────────────────────────────

class AudioService {
  /** category → array of { audio, id? (undefined for defaults), name } */
  private clips = new Map<SoundName, { audio: HTMLAudioElement; id?: number; name: string }[]>();
  /** category → next index to play */
  private indices = new Map<SoundName, number>();
  private settings: SoundSettings;
  private _ready: Promise<void>;
  private _listeners = new Set<() => void>();

  constructor() {
    this.settings = this.loadSettings();
    this._ready = this.init();
  }

  /** Wait for IndexedDB clips to be loaded. */
  ready(): Promise<void> {
    return this._ready;
  }

  /** Subscribe to clip list changes (add/remove). Returns unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this._listeners) fn();
  }

  private loadSettings(): SoundSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
          volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_SETTINGS.volume,
          rotate: typeof parsed.rotate === 'object' && parsed.rotate !== null ? parsed.rotate : {},
          clipOrder: typeof parsed.clipOrder === 'object' && parsed.clipOrder !== null ? parsed.clipOrder : {},
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
  }

  /** Unique key for a clip entry (used for ordering) */
  private clipKey(clip: { id?: number }): string {
    return clip.id !== undefined ? String(clip.id) : 'default';
  }

  private async init(): Promise<void> {
    for (const name of SOUND_NAMES) {
      this.indices.set(name, 0);
      // Always include the default clip first
      const list: { audio: HTMLAudioElement; id?: number; name: string }[] = [
        { audio: this.createAudio(`/sounds/${name}/1.mp3`), name: 'Default' },
      ];
      // Append any user-uploaded clips
      const records = await getAllClips(name);
      for (const r of records) {
        list.push({
          audio: this.createAudio(URL.createObjectURL(r.blob)),
          id: r.id,
          name: r.name,
        });
      }
      // Apply saved order if available
      const savedOrder = this.settings.clipOrder[name];
      if (savedOrder && savedOrder.length > 0) {
        const byKey = new Map(list.map(c => [this.clipKey(c), c]));
        const sorted: typeof list = [];
        for (const key of savedOrder) {
          const clip = byKey.get(key);
          if (clip) {
            sorted.push(clip);
            byKey.delete(key);
          }
        }
        // Append any clips not in saved order (newly added)
        for (const clip of byKey.values()) sorted.push(clip);
        this.clips.set(name, sorted);
      } else {
        this.clips.set(name, list);
      }
    }
  }

  private createAudio(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = this.settings.volume;
    return audio;
  }

  // ── Public: playback ──────────────────────────────────────────

  play(name: SoundName): void {
    if (!this.settings.enabled) return;
    const list = this.clips.get(name);
    if (!list || list.length === 0) return;

    const shouldRotate = this.settings.rotate[name] !== false; // default true
    const idx = shouldRotate ? (this.indices.get(name) ?? 0) : 0;
    const { audio } = list[idx];
    if (shouldRotate) this.indices.set(name, (idx + 1) % list.length);

    audio.currentTime = 0;
    audio.volume = this.settings.volume;
    audio.play().catch(() => {});
  }

  playClip(name: SoundName, index: number): void {
    const list = this.clips.get(name);
    if (!list || index < 0 || index >= list.length) return;
    const { audio } = list[index];
    audio.currentTime = 0;
    audio.volume = this.settings.volume;
    audio.play().catch(() => {});
  }

  // ── Public: clip management ───────────────────────────────────

  getClips(name: SoundName): { id?: number; name: string }[] {
    return (this.clips.get(name) ?? []).map(c => ({ id: c.id, name: c.name }));
  }

  getClipCount(name: SoundName): number {
    return this.clips.get(name)?.length ?? 0;
  }

  async addClips(category: SoundName, files: File[]): Promise<void> {
    const currentList = this.clips.get(category) ?? [];

    for (const file of files) {
      const id = await addClip({ category, name: file.name, blob: file });
      const url = URL.createObjectURL(file);
      currentList.push({ audio: this.createAudio(url), id, name: file.name });
    }

    this.clips.set(category, currentList);
    this.indices.set(category, 0);
    this.notify();
  }

  async removeClip(category: SoundName, clipId: number): Promise<void> {
    await deleteClip(clipId);
    const list = this.clips.get(category) ?? [];
    const idx = list.findIndex(c => c.id === clipId);
    if (idx !== -1) {
      const src = list[idx].audio.src;
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
      list.splice(idx, 1);
    }

    this.clips.set(category, list);
    this.indices.set(category, 0);
    this.notify();
  }

  reorderClip(category: SoundName, fromIndex: number, toIndex: number): void {
    const list = this.clips.get(category);
    if (!list || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    this.indices.set(category, 0);
    // Persist order
    this.settings.clipOrder[category] = list.map(c => this.clipKey(c));
    this.saveSettings();
    this.notify();
  }

  // ── Public: settings ──────────────────────────────────────────

  getEnabled(): boolean {
    return this.settings.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.saveSettings();
  }

  getVolume(): number {
    return this.settings.volume;
  }

  getRotate(name: SoundName): boolean {
    return this.settings.rotate[name] !== false; // default true
  }

  setRotate(name: SoundName, rotate: boolean): void {
    this.settings.rotate[name] = rotate;
    if (!rotate) this.indices.set(name, 0); // reset to first clip
    this.saveSettings();
    this.notify();
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.max(0, Math.min(1, volume));
    for (const list of this.clips.values()) {
      for (const { audio } of list) {
        audio.volume = this.settings.volume;
      }
    }
    this.saveSettings();
  }
}

export const audioService = new AudioService();
