/**
 * Coalesce individual lookups made within a short window into one batched call.
 *
 * `load(key)` calls made inside `delayMs` of the first one are sent together to `run`, which
 * returns results by key; keys it omits resolve to `missing(key)`. A rejected `run` rejects
 * every waiter of that batch.
 */
export class Batcher<K, V> {
  private pending?: Map<K, Array<{ resolve: (value: V) => void; reject: (error: unknown) => void }>>;

  constructor(
    private readonly delayMs: number,
    private readonly run: (keys: K[]) => Promise<Map<K, V>>,
    private readonly missing: (key: K) => V,
  ) {}

  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      if (!this.pending) {
        const batch = new Map<K, Array<{ resolve: (value: V) => void; reject: (error: unknown) => void }>>();
        this.pending = batch;
        setTimeout(() => {
          this.pending = undefined;
          void this.flush(batch);
        }, this.delayMs);
      }
      const waiters = this.pending.get(key) ?? [];
      waiters.push({ resolve, reject });
      this.pending.set(key, waiters);
    });
  }

  private async flush(batch: NonNullable<Batcher<K, V>['pending']>): Promise<void> {
    try {
      const results = await this.run([...batch.keys()]);
      for (const [key, waiters] of batch) {
        const value = results.has(key) ? (results.get(key) as V) : this.missing(key);
        for (const w of waiters) w.resolve(value);
      }
    } catch (error) {
      for (const waiters of batch.values()) for (const w of waiters) w.reject(error);
    }
  }
}
