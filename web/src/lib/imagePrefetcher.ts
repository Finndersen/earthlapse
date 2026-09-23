/**
 * Fetches encoded image bytes ahead of need into a bounded in-memory store, so a later decode
 * (`fetchImage` with `load` as its blob loader) makes no network request. Decoding and GPU upload
 * stay with the caller: this only moves bytes.
 *
 * `want(urgent, background)` states the whole wanted set, each list in priority order, replacing
 * the previous call's. Urgent URLs start at once. Background URLs start in list order while fewer
 * than `concurrency` requests of either kind are in flight, so background work never holds back
 * more than `concurrency - 1` requests' worth of bandwidth from an urgent one. A request that drops
 * out of both lists is aborted, whichever call started it, unless it is `NEARLY_DONE` downloaded;
 * one that stays keeps running wherever it moved to. An aborted URL is not remembered: wanting or
 * loading it again refetches it. `load` joins a request already in flight instead of starting a
 * second one; one it starts for a URL no list names lasts until the next `want`.
 *
 * Stored bytes are evicted least recently used once they total more than `maxBytes`, skipping any
 * URL still wanted, so memory stays within `maxBytes` plus the wanted set itself.
 */

import { fetchImageBlob } from './fetchImage'

export type BlobFetcher = (url: string, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<Blob>

export interface ImagePrefetcherOptions {
  /** Most requests in flight before a background URL waits; urgent URLs never wait. */
  concurrency: number
  maxBytes: number
  fetchBlob?: BlobFetcher
}

export interface ImagePrefetcher {
  want(urgent: readonly string[], background: readonly string[]): void
  /** `url`'s bytes, from the store, from the request already in flight, or fetched now.
   *  `onProgress` reports the download from whenever this call joins it, ending at 1. */
  load(url: string, onProgress?: (fraction: number) => void): Promise<Blob>
  /** Resolves once `url`'s bytes are stored. Rejects with an `AbortError` if `url` leaves the
   *  wanted set first (or was never in it), or with the fetch's own error if it fails. */
  whenStored(url: string): Promise<void>
  has(url: string): boolean
  storedBytes(): number
  inFlight(): string[]
}

/** A request this far through its download finishes even once no longer wanted: the few bytes
 *  left cost less than refetching them if the URL is wanted again. */
export const NEARLY_DONE = 0.8

interface Request {
  controller: AbortController
  /** Downloaded so far, 0..1; stays 0 when the response has no `Content-Length`. */
  fraction: number
  listeners: Set<(fraction: number) => void>
  promise: Promise<Blob>
}

interface Waiter {
  resolve: () => void
  reject: (error: unknown) => void
}

function abortError(url: string): DOMException {
  return new DOMException(`prefetch of ${url} no longer wanted`, 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function createImagePrefetcher({
  concurrency,
  maxBytes,
  fetchBlob = fetchImageBlob,
}: ImagePrefetcherOptions): ImagePrefetcher {
  // Insertion order is recency order: a hit is deleted and re-inserted.
  const stored = new Map<string, Blob>()
  let bytes = 0
  const requests = new Map<string, Request>()
  const waiters = new Map<string, Waiter[]>()
  // Background retries of a failed URL would repeat on every `want`; only `load` retries it.
  const failed = new Set<string>()
  let urgentList: readonly string[] = []
  let backgroundList: readonly string[] = []
  let wanted = new Set<string>()

  function settleWaiters(url: string, error?: unknown): void {
    const list = waiters.get(url)
    if (list === undefined) return
    waiters.delete(url)
    for (const waiter of list) {
      if (error === undefined) waiter.resolve()
      else waiter.reject(error)
    }
  }

  function trim(): void {
    for (const [url, blob] of stored) {
      if (bytes <= maxBytes) return
      if (wanted.has(url)) continue
      stored.delete(url)
      bytes -= blob.size
    }
  }

  function store(url: string, blob: Blob): void {
    const previous = stored.get(url)
    if (previous !== undefined) bytes -= previous.size
    stored.delete(url)
    stored.set(url, blob)
    bytes += blob.size
    trim()
  }

  function start(url: string): Request {
    const controller = new AbortController()
    const listeners = new Set<(fraction: number) => void>()
    const report = (fraction: number): void => {
      request.fraction = fraction
      for (const listener of listeners) listener(fraction)
    }
    const request: Request = {
      controller,
      fraction: 0,
      listeners,
      promise: fetchBlob(url, report, controller.signal).then(
        (blob) => {
          if (requests.get(url) === request) requests.delete(url)
          failed.delete(url)
          store(url, blob)
          settleWaiters(url)
          pump()
          return blob
        },
        (error: unknown) => {
          if (requests.get(url) === request) requests.delete(url)
          if (!controller.signal.aborted) {
            failed.add(url)
            settleWaiters(url, error)
          }
          pump()
          throw error
        },
      ),
    }
    // A request `want` started has no caller of its own to observe its rejection.
    request.promise.catch(() => undefined)
    requests.set(url, request)
    return request
  }

  function idle(url: string): boolean {
    return !stored.has(url) && !requests.has(url) && !failed.has(url)
  }

  function pump(): void {
    for (const url of urgentList) if (idle(url)) start(url)
    for (const url of backgroundList) {
      if (requests.size >= concurrency) return
      if (idle(url)) start(url)
    }
  }

  return {
    want(urgent, background) {
      urgentList = urgent
      backgroundList = background
      wanted = new Set([...urgent, ...background])
      for (const [url, request] of requests) {
        if (wanted.has(url) || request.fraction >= NEARLY_DONE) continue
        requests.delete(url)
        request.controller.abort()
        settleWaiters(url, abortError(url))
      }
      for (const url of [...waiters.keys()]) {
        if (!wanted.has(url) && !requests.has(url)) settleWaiters(url, abortError(url))
      }
      trim()
      pump()
    },

    load(url, onProgress) {
      const blob = stored.get(url)
      if (blob !== undefined) {
        stored.delete(url)
        stored.set(url, blob)
        onProgress?.(1)
        return Promise.resolve(blob)
      }
      const request = requests.get(url) ?? start(url)
      if (onProgress !== undefined) request.listeners.add(onProgress)
      return request.promise
    },

    whenStored(url) {
      if (stored.has(url)) return Promise.resolve()
      if (!requests.has(url)) {
        if (failed.has(url)) return Promise.reject(new Error(`prefetch of ${url} failed`))
        if (!wanted.has(url)) return Promise.reject(abortError(url))
      }
      return new Promise<void>((resolve, reject) => {
        const list = waiters.get(url) ?? []
        list.push({ resolve, reject })
        waiters.set(url, list)
      })
    },

    has: (url) => stored.has(url),
    storedBytes: () => bytes,
    inFlight: () => [...requests.keys()],
  }
}
