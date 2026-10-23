/**
 * Small keyed cache of promises with a TTL and a size cap (oldest evicted first).
 *
 * Storing the promise means concurrent callers for the same key share one in-flight load.
 * Failed loads are evicted so the next call retries; `keep` lets a caller also refuse to
 * remember a successful-but-unwanted result (e.g. "tag not found" may exist later).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: Promise<V> }>();

  constructor(private readonly ttlMs: number, private readonly max = 500) {}

  /** The live (unexpired) entry, if any. Refreshes recency. */
  peek(key: string): Promise<V> | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  has(key: string): boolean {
    return this.peek(key) !== undefined;
  }

  getOrLoad(key: string, load: () => Promise<V>, keep: (value: V) => boolean = () => true): Promise<V> {
    return this.peek(key) ?? this.store(key, load(), keep);
  }

  /** Store a value or an in-flight load, replacing any entry for the key. */
  set(key: string, value: V | Promise<V>, keep: (value: V) => boolean = () => true): void {
    void this.store(key, value, keep);
  }

  private store(key: string, value: V | Promise<V>, keep: (value: V) => boolean): Promise<V> {
    const promise = Promise.resolve(value);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: Date.now(), value: promise });
    promise.then(
      (v) => { if (!keep(v)) this.evict(key, promise); },
      () => this.evict(key, promise),
    );
    return promise;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Remove `key` only if it still holds this promise (a newer set() for the key stays). */
  private evict(key: string, promise: Promise<V>): void {
    if (this.entries.get(key)?.value === promise) this.entries.delete(key);
  }
}
