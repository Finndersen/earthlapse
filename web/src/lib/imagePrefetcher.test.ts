import { describe, expect, it } from 'vitest'

import { createImagePrefetcher, isAbortError, type BlobFetcher } from './imagePrefetcher'

interface PendingFetch {
  url: string
  signal: AbortSignal
  onProgress: (fraction: number) => void
  resolve: (size?: number) => void
  reject: (error: unknown) => void
}

/** A fetcher whose requests settle only when a test says so. */
function controlledFetcher(): { fetchBlob: BlobFetcher; pending: PendingFetch[]; started: string[] } {
  const pending: PendingFetch[] = []
  const started: string[] = []
  const fetchBlob: BlobFetcher = (url, onProgress, signal) =>
    new Promise<Blob>((resolve, reject) => {
      started.push(url)
      const entry: PendingFetch = {
        url,
        signal,
        onProgress,
        resolve: (size = 100) => {
          pending.splice(pending.indexOf(entry), 1)
          resolve(new Blob([new Uint8Array(size)]))
        },
        reject: (error) => {
          pending.splice(pending.indexOf(entry), 1)
          reject(error)
        },
      }
      signal.addEventListener('abort', () => entry.reject(new DOMException('aborted', 'AbortError')))
      pending.push(entry)
    })
  return { fetchBlob, pending, started }
}

function find(pending: readonly PendingFetch[], url: string): PendingFetch {
  const entry = pending.find((p) => p.url === url)
  if (entry === undefined) throw new Error(`${url} is not in flight`)
  return entry
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createImagePrefetcher', () => {
  it('starts urgent URLs first, then background URLs in order up to the concurrency limit', () => {
    const { fetchBlob, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 3, maxBytes: 10_000, fetchBlob })

    prefetcher.want(['pair-a', 'pair-b'], ['decode-1', 'decode-2', 'fetch-1'])

    expect(started).toEqual(['pair-a', 'pair-b', 'decode-1'])
  })

  it('starts the next background URL as each request finishes', async () => {
    const { fetchBlob, pending, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 2, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a', 'b', 'c', 'd'])

    find(pending, 'a').resolve()
    await flush()

    expect(started).toEqual(['a', 'b', 'c'])
    expect(prefetcher.has('a')).toBe(true)
  })

  it('starts an urgent URL even while background requests fill every slot', () => {
    const { fetchBlob, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 2, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a', 'b', 'c'])

    void prefetcher.load('now')

    expect(started).toEqual(['a', 'b', 'now'])
  })

  it('makes one request for a URL however many callers ask for it', async () => {
    const { fetchBlob, pending, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 3, maxBytes: 10_000, fetchBlob })

    prefetcher.want([], ['a'])
    prefetcher.want(['a'], ['a'])
    const first = prefetcher.load('a')
    const second = prefetcher.load('a')
    find(pending, 'a').resolve()
    const [blobA, blobB] = await Promise.all([first, second])
    const third = await prefetcher.load('a')

    expect(started).toEqual(['a'])
    expect(blobB).toBe(blobA)
    expect(third).toBe(blobA)
  })

  it('aborts a background request that leaves the wanted set, and keeps one that stays', () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 3, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a', 'b', 'c'])
    const signalA = find(pending, 'a').signal
    const signalB = find(pending, 'b').signal

    prefetcher.want([], ['b', 'x'])

    expect(signalA.aborted).toBe(true)
    expect(signalB.aborted).toBe(false)
    expect(prefetcher.inFlight().sort()).toEqual(['b', 'x'])
  })

  it('never aborts a request a caller is waiting on', async () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 3, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a'])
    const loaded = prefetcher.load('a')

    prefetcher.want([], [])
    expect(find(pending, 'a').signal.aborted).toBe(false)
    find(pending, 'a').resolve(42)

    expect((await loaded).size).toBe(42)
  })

  it('fills a freed slot with the next wanted URL after an abort', () => {
    const { fetchBlob, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 1, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a', 'b'])

    prefetcher.want([], ['c', 'b'])

    expect(started).toEqual(['a', 'c'])
  })

  it('resolves whenStored once the bytes arrive, and rejects it with an AbortError when dropped', async () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 1, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a', 'queued'])
    const stored = prefetcher.whenStored('a')
    const dropped = prefetcher.whenStored('queued')

    prefetcher.want([], ['a'])
    find(pending, 'a').resolve()

    await expect(stored).resolves.toBeUndefined()
    await expect(dropped).rejects.toSatisfy(isAbortError)
    await expect(prefetcher.whenStored('never-wanted')).rejects.toSatisfy(isAbortError)
  })

  it('rejects whenStored with the fetch error and does not retry the URL in the background', async () => {
    const { fetchBlob, pending, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 1, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['bad'])
    const stored = prefetcher.whenStored('bad')

    find(pending, 'bad').reject(new Error('HTTP 404'))
    await expect(stored).rejects.toThrow('HTTP 404')
    prefetcher.want([], ['bad'])

    expect(started).toEqual(['bad'])
    await expect(prefetcher.whenStored('bad')).rejects.toThrow()
  })

  it('reports progress to a caller that joins a request in flight', async () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 1, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a'])
    const progress: number[] = []

    const loaded = prefetcher.load('a', (fraction) => progress.push(fraction))
    find(pending, 'a').onProgress(0.5)
    find(pending, 'a').onProgress(1)
    find(pending, 'a').resolve()
    await loaded

    expect(progress).toEqual([0.5, 1])
  })

  it('evicts the least recently used bytes beyond its budget, but never a wanted URL', async () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 4, maxBytes: 250, fetchBlob })
    prefetcher.want([], ['old', 'kept', 'newer'])
    find(pending, 'old').resolve(100)
    find(pending, 'kept').resolve(100)
    find(pending, 'newer').resolve(100)
    await flush()
    expect(prefetcher.storedBytes()).toBe(300)

    prefetcher.want([], ['kept', 'next'])
    find(pending, 'next').resolve(100)
    await flush()

    expect(prefetcher.has('kept')).toBe(true)
    expect(prefetcher.has('next')).toBe(true)
    expect(prefetcher.has('old')).toBe(false)
    expect(prefetcher.has('newer')).toBe(false)
    expect(prefetcher.storedBytes()).toBe(200)
  })

  it('serves stored bytes without a request and reports them complete', async () => {
    const { fetchBlob, pending, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 1, maxBytes: 10_000, fetchBlob })
    prefetcher.want([], ['a'])
    find(pending, 'a').resolve()
    await flush()
    const progress: number[] = []

    await prefetcher.load('a', (fraction) => progress.push(fraction))

    expect(started).toEqual(['a'])
    expect(progress).toEqual([1])
  })
})
