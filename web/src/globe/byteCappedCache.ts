/**
 * A least-recently-used cache bounded by total *decoded bytes* rather than entry count
 * (`lru.ts`'s `LruCache`) — the human-era globe textures (`humanEraTextureCache.ts`) vary a
 * lot in size between tiers (T0 2048x1024 vs T1 4096x2048, roughly 4x the bytes), so a fixed
 * slot count would either waste headroom at T0 or blow the budget at T1. `sizeOf` is supplied
 * by the caller rather than assumed (this module has no three.js dependency, so it stays unit
 * testable without a texture at all — mirrors `lru.ts`'s own "pure bookkeeping" split from
 * `textureCache.ts`).
 *
 * Same eviction discipline as `LruCache`: nothing is evicted on insert, only on `trim(keep)`,
 * so a texture still bound to the screen is never disposed out from under a render.
 */

export class ByteCappedCache<V> {
  private readonly entries = new Map<string, { value: V; bytes: number }>()
  private totalBytes = 0

  constructor(
    readonly capacityBytes: number,
    private readonly onEvict: (value: V, key: string) => void,
    private readonly sizeOf: (value: V) => number,
  ) {
    if (!Number.isFinite(capacityBytes) || capacityBytes <= 0) {
      throw new Error(`ByteCappedCache capacityBytes must be a positive number, got ${capacityBytes}`)
    }
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.totalBytes
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** Returns the value and marks it most recently used. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /** Inserts as most recently used. Replacing an existing key is a caller bug, same as
   *  `LruCache.set` — the old value would leak without ever reaching `onEvict`. */
  set(key: string, value: V): void {
    if (this.entries.has(key)) throw new Error(`ByteCappedCache already holds ${key}`)
    const bytes = this.sizeOf(value)
    this.entries.set(key, { value, bytes })
    this.totalBytes += bytes
  }

  /** Evicts least-recently-used entries, oldest first, until `bytes <= capacityBytes` — never
   *  touching a key in `keep`, so the cache can briefly exceed its byte cap while everything
   *  in it is genuinely in use (the same trade-off `LruCache.trim` makes for entry count). */
  trim(keep: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (this.totalBytes <= this.capacityBytes) return
      if (keep.has(key)) continue
      this.entries.delete(key)
      this.totalBytes -= entry.bytes
      this.onEvict(entry.value, key)
    }
  }

  /** Evicts every entry unconditionally, ignoring both the byte cap and `keep` — unlike `trim`,
   *  which only evicts *down to* capacity (a no-op for a cache already under budget). Needed
   *  when every cached value is invalid regardless of how much of the budget it uses, not just
   *  when the budget is exceeded — `humanEraTextureCache.ts`'s own `clear()` uses this after a
   *  WebGL context loss, where every cached texture's GPU resource is gone. */
  clear(): void {
    for (const [key, entry] of this.entries) this.onEvict(entry.value, key)
    this.entries.clear()
    this.totalBytes = 0
  }
}
