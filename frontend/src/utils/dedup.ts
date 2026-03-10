/**
 * Creates a deduplicating wrapper around an async function.
 * Concurrent calls with the same key share a single in-flight promise.
 * Once the promise settles, the next call starts a fresh request.
 *
 * Single-key variant: omit key parameter (uses a fixed key internally).
 * Map-based variant: pass a key string to dedup by argument.
 */

/** Wrap a no-arg async function so concurrent calls share one in-flight promise. */
export function dedup<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (inflight) return inflight;
    inflight = fn().finally(() => { inflight = null; });
    return inflight;
  };
}

/** Wrap a keyed async function so concurrent calls with the same key share one promise. */
export function dedupByKey<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const inflight = new Map<string, Promise<T>>();
  return (key: string) => {
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = fn(key).finally(() => { inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  };
}
