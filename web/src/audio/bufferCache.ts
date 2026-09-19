/**
 * Which stem buffers are loaded, loading, or errored, and what to fetch or evict each tick —
 * the stateful counterpart to `loadPlan.ts`'s pure `stemsNeeded` (ADR-023 amendment "on-demand
 * loading"). Generic over the decoded buffer type (`Handle`) so this module owns no Tone.js
 * import of its own and is exercised directly, the same way `globe/lru.ts` is: plain bookkeeping
 * methods with no I/O and no timers of their own — `engine.ts` is the only caller that does the
 * actual fetch/decode/dispose and supplies the wall clock.
 *
 * Three eviction/retry rules, all applied every `plan()` call, none ever touching an id in
 * `needed`:
 *
 * - **Idle timeout** — a `ready` stem not in `needed` for more than `evictAfterMs` wall-clock
 *   time is evicted, so a stem the lookahead window has moved well past stops holding its
 *   buffer indefinitely "just in case".
 * - **Decoded-bytes cap** — independent of how recently a stem was needed, the *total* decoded
 *   size across every `ready` buffer (plus an estimate for anything still `loading`, so a burst
 *   of new fetches cannot land and blow straight past the budget) is kept under
 *   `decodedBytesCap` (mobile memory), evicting the least-recently-needed ready stems first
 *   until back under budget. This can evict a stem before its idle timeout if the cap alone
 *   requires it. Measured in bytes, not seconds — a stereo 48 kHz stem decodes to roughly 4x the
 *   memory of a mono 24 kHz one of the same duration, so a duration-only figure is not a real
 *   memory bound.
 * - **Error backoff** — a failed fetch/decode does not retry on the very next `plan()` call
 *   (~80ms later, `engine.ts`'s tick cadence): each consecutive failure doubles the delay before
 *   the next attempt (`INITIAL_RETRY_BACKOFF_MS`, capped at `MAX_RETRY_BACKOFF_MS`), and a
 *   *decode* failure (the browser cannot play this container/codec at all, ever, this session —
 *   `engine.ts` calls `markPermanentlyFailed` for those, never `markFailed`) is never retried —
 *   see `markFailed`'s own doc comment for why a *network* failure keeps retrying indefinitely
 *   instead of eventually giving up.
 */

import type { StemId } from './stemIds'

export type LoadStatus = 'loading' | 'ready' | 'error'

interface Entry<Handle> {
  status: LoadStatus
  handle: Handle | null
  /** Decoded size in bytes while `ready`; an *estimate* of that same figure (`markFetching`'s
   *  `estimatedBytes`) while `loading`, so the decoded-bytes cap accounts for fetches already in
   *  flight, not only what has actually landed; 0 while `error`. */
  bytes: number
  lastNeededMs: number
  /** Consecutive failures since the last success, 0 while not `error`. Only meaningful for a
   *  retryable (non-`permanent`) error entry — drives the exponential backoff. */
  attempt: number
  /** Earliest `nowMs` `plan()` will offer this id in `toFetch` again. `-Infinity` for every
   *  status but `error`. */
  retryAtMs: number
  /** A decode failure: this browser cannot play this stem's format, full stop — retrying gains
   *  nothing, ever, this session. Only meaningful for an `error` entry. */
  permanent: boolean
}

export interface StemFetchPlan {
  /** Ids to start fetching this call, in `needed`'s own iteration order (`loadPlan.ts`'s
   *  `stemsNeeded` documents that order as nearest-priority-first), capped by the free
   *  concurrency slots. Never one already `ready` or `loading`, and never a permanently-failed
   *  or still-backed-off `error` entry. */
  toFetch: StemId[]
  /** Ids whose `ready` buffer should be disposed this call. Never one in `needed`, and never
   *  the same id twice. */
  toEvict: StemId[]
}

const DEFAULT_MAX_CONCURRENT = 3
const DEFAULT_EVICT_AFTER_MS = 60_000
/** Generic bookkeeping-test default, not tuned to any real catalogue — `engine.ts` always
 *  passes its own measured, mobile-sized figure explicitly (see `DECODED_BYTES_CAP` there). */
const DEFAULT_DECODED_BYTES_CAP = 200_000_000

/** First retry delay after a failure; doubles each consecutive failure up to
 *  `MAX_RETRY_BACKOFF_MS` — without this, a broken stem (an unsupported codec on that browser)
 *  would retry every tick, up to 12x/second, for as long as it stayed in `needed`. */
const INITIAL_RETRY_BACKOFF_MS = 2_000
const MAX_RETRY_BACKOFF_MS = 60_000

export class StemBufferCache<Handle> {
  private readonly entries = new Map<StemId, Entry<Handle>>()

  constructor(
    private readonly maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
    private readonly evictAfterMs: number = DEFAULT_EVICT_AFTER_MS,
    private readonly decodedBytesCap: number = DEFAULT_DECODED_BYTES_CAP,
  ) {}

  status(id: StemId): LoadStatus | 'absent' {
    return this.entries.get(id)?.status ?? 'absent'
  }

  /** The ready handle for `id`, or `undefined` if it is absent, still loading, or errored. */
  handle(id: StemId): Handle | undefined {
    const entry = this.entries.get(id)
    return entry?.status === 'ready' && entry.handle !== null ? entry.handle : undefined
  }

  /** Total decoded bytes across every currently-`ready` buffer — actual resident memory, not
   *  including anything still `loading` (see `plan()`'s own accounting for why fetches in
   *  flight still count against the cap even though they are not in this total yet). */
  get decodedBytesTotal(): number {
    let total = 0
    for (const entry of this.entries.values()) if (entry.status === 'ready') total += entry.bytes
    return total
  }

  /** @param estimatedBytes A caller-supplied estimate of the decoded size this fetch will land
   *   at (e.g. published duration x an assumed channel count/sample rate) — reserved against
   *   the decoded-bytes cap for as long as the fetch is in flight, replaced by the real figure
   *   once `markReady` runs, so several fetches starting together cannot all land and blow past
   *   the budget before the next `plan()` call gets a chance to react. */
  markFetching(id: StemId, nowMs: number, estimatedBytes = 0): void {
    this.entries.set(id, {
      status: 'loading',
      handle: null,
      bytes: estimatedBytes,
      lastNeededMs: nowMs,
      attempt: 0,
      retryAtMs: -Infinity,
      permanent: false,
    })
  }

  markReady(id: StemId, handle: Handle, bytes: number, nowMs: number): void {
    this.entries.set(id, { status: 'ready', handle, bytes, lastNeededMs: nowMs, attempt: 0, retryAtMs: -Infinity, permanent: false })
  }

  /** A *retryable* failed fetch/decode (a network error, or any transient failure that is not
   *  specifically a decode/format error — see `markPermanentlyFailed`). `plan()` offers it again
   *  once `nowMs` passes an exponentially-growing backoff from this call's `nowMs`, doubling per
   *  consecutive failure and capped at `MAX_RETRY_BACKOFF_MS` — a transient network failure must
   *  not permanently blacklist a stem for the rest of the session, but it also must not retry on
   *  literally the next tick forever. */
  markFailed(id: StemId, nowMs: number): void {
    const attempt = (this.entries.get(id)?.attempt ?? 0) + 1
    const backoffMs = Math.min(MAX_RETRY_BACKOFF_MS, INITIAL_RETRY_BACKOFF_MS * 2 ** (attempt - 1))
    this.entries.set(id, { status: 'error', handle: null, bytes: 0, lastNeededMs: nowMs, attempt, retryAtMs: nowMs + backoffMs, permanent: false })
  }

  /** A failure `plan()` never retries this session — a decode/format error (`engine.ts`'s
   *  `EncodingError` case): the browser genuinely cannot play this container/codec, so retrying
   *  wastes bandwidth and CPU for a result that can only ever repeat. */
  markPermanentlyFailed(id: StemId, nowMs: number): void {
    this.entries.set(id, { status: 'error', handle: null, bytes: 0, lastNeededMs: nowMs, attempt: 0, retryAtMs: Infinity, permanent: true })
  }

  /** Drops all bookkeeping for `id`. The caller has already disposed its handle (if any) —
   *  called once per id in a `plan()` result's `toEvict`, or when an in-flight fetch is aborted
   *  because its stem left `needed` before landing (`engine.ts`'s `runLoaderStep`) — never on
   *  its own initiative. */
  forget(id: StemId): void {
    this.entries.delete(id)
  }

  /** Every id with a `loading`, `ready` or `error` entry — for a caller that needs to dispose
   *  everything at once (`engine.ts`'s runtime teardown) or list loader state for diagnostics
   *  (`getLoaderState()`'s dev hook), not one eviction decision at a time. */
  trackedIds(): StemId[] {
    return [...this.entries.keys()]
  }

  /**
   * One planning step. First refreshes `lastNeededMs` for every id already tracked and present
   * in `needed`, so the idle-timeout clock only ever counts time actually spent outside the
   * wanted set. Then returns what to fetch and what to evict this call.
   *
   * `needed` is also the fetch-priority order: a JS `Set`'s iteration order is its insertion
   * order, and `loadPlan.ts`'s `stemsNeeded` documents that order as nearest-priority-first, so
   * `plan()` takes just the one `Set` rather than a second, independently-supplied ordering that
   * could disagree with it.
   */
  plan(needed: ReadonlySet<StemId>, nowMs: number): StemFetchPlan {
    for (const id of needed) {
      const entry = this.entries.get(id)
      if (entry !== undefined) entry.lastNeededMs = nowMs
    }

    let loadingCount = 0
    for (const entry of this.entries.values()) if (entry.status === 'loading') loadingCount++
    const freeSlots = Math.max(0, this.maxConcurrent - loadingCount)

    const toFetch: StemId[] = []
    for (const id of needed) {
      if (toFetch.length >= freeSlots) break
      const entry = this.entries.get(id)
      if (entry === undefined) {
        toFetch.push(id)
      } else if (entry.status === 'error' && !entry.permanent && nowMs >= entry.retryAtMs) {
        toFetch.push(id)
      }
    }

    const toEvict: StemId[] = []
    const readyNotNeeded: [StemId, Entry<Handle>][] = []
    for (const [id, entry] of this.entries) {
      if (entry.status !== 'ready' || needed.has(id)) continue
      readyNotNeeded.push([id, entry])
      if (nowMs - entry.lastNeededMs > this.evictAfterMs) toEvict.push(id)
    }

    const evictedAlready = new Set(toEvict)
    const stillReady = readyNotNeeded.filter(([id]) => !evictedAlready.has(id))
    stillReady.sort((a, b) => a[1].lastNeededMs - b[1].lastNeededMs)
    // Ready buffers plus an estimate for everything still loading — a fetch about to land
    // must not be able to push the total straight past the cap before the next `plan()` call
    // gets a chance to evict for it.
    let committed = this.decodedBytesTotal
    for (const entry of this.entries.values()) if (entry.status === 'loading') committed += entry.bytes
    for (const [id, entry] of stillReady) {
      if (committed <= this.decodedBytesCap) break
      toEvict.push(id)
      committed -= entry.bytes
    }

    return { toFetch, toEvict }
  }
}
