/**
 * Persist and retrieve a FileSystemDirectoryHandle via IndexedDB.
 * The user picks a folder once with showDirectoryPicker(), and we store the handle
 * so it survives page reloads. On next session, we verify the permission is still granted.
 */

const DB_NAME = 'RecordingSettings';
const STORE_NAME = 'handles';
const KEY = 'recordingsDir';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Store the directory handle in IndexedDB. */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Retrieve the stored directory handle, or null if none saved. */
export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Clear the stored directory handle. */
export async function clearDirectoryHandle(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

/**
 * Get a ready-to-use directory handle: load from IndexedDB, verify permission.
 * Returns null if no handle stored or permission denied.
 */
export async function getReadyDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadDirectoryHandle();
  if (!handle) return null;

  // Check if we still have permission (may need to re-request after browser restart)
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return handle;

  // Try requesting permission (this will show a prompt the first time after restart)
  const requested = await handle.requestPermission({ mode: 'readwrite' });
  if (requested === 'granted') return handle;

  return null;
}

/**
 * Prompt the user to pick a directory. Saves the handle for future use.
 * Returns the handle, or null if the user cancelled.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof (window as any).showDirectoryPicker !== 'function') {
    console.error('[Recording] showDirectoryPicker not available — requires Chrome/Edge on HTTPS or localhost');
    return null;
  }
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await saveDirectoryHandle(handle);
    return handle;
  } catch (err) {
    // AbortError = user cancelled, everything else is a real error
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    console.error('[Recording] pickDirectory failed:', err);
    return null;
  }
}
