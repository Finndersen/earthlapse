/**
 * A small least-recently-used map with an explicit trim step. Pure bookkeeping (no three.js)
 * so it is unit testable; `textureCache.ts` wraps it around GPU textures.
 *
 * Eviction is deliberately NOT automatic on insert: only the caller knows which entries are
 * on screen right now, and disposing a texture that is still bound would blank the globe.
 * `trim(keep)` evicts least-recently-used entries until the cache is back within capacity,
 * never touching a key in `keep` (so a cache can briefly exceed capacity when everything in
 * it is in use).
 */

export class LruCache<V> {
  private readonly entries = new Map<string, V>()

  constructor(
    readonly capacity: number,
    private readonly onEvict: (value: V, key: string) => void,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LruCache capacity must be a positive integer, got ${capacity}`)
    }
  }

  get size(): number {
    return this.entries.size
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** Returns the value and marks it most recently used. */
  get(key: string): V | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  /** Inserts as most recently used. Replacing an existing key is a caller bug: the old value
   *  would leak without ever reaching `onEvict`. */
  set(key: string, value: V): void {
    if (this.entries.has(key)) throw new Error(`LruCache already holds ${key}`)
    this.entries.set(key, value)
  }

  trim(keep: ReadonlySet<string>): void {
    for (const [key, value] of this.entries) {
      if (this.entries.size <= this.capacity) return
      if (keep.has(key)) continue
      this.entries.delete(key)
      this.onEvict(value, key)
    }
  }
}
