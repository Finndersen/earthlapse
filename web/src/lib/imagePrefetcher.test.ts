import { describe, expect, it } from 'vitest'

import { createImagePrefetcher, NEARLY_DONE, type BlobFetcher } from './imagePrefetcher'

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
  it('starts urgent URLs first, fills slots in order, dedupes, and aborts whatever leaves the wanted set unless nearly done', async () => {
    const { fetchBlob, pending, started } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 3, maxBytes: 10_000, fetchBlob })
    prefetcher.want(['pair-a', 'pair-b'], ['next-1', 'next-2', 'next-3'])
    expect(started).toEqual(['pair-a', 'pair-b', 'next-1'])

    const waitedOn = prefetcher.load('pair-a')
    void prefetcher.load('pair-a')
    find(pending, 'pair-b').resolve()
    await flush()
    expect(started).toEqual(['pair-a', 'pair-b', 'next-1', 'next-2'])

    const next1 = find(pending, 'next-1').signal
    prefetcher.want(['pair-a'], ['next-2', 'other'])
    expect(next1.aborted).toBe(true)
    expect(prefetcher.inFlight().sort()).toEqual(['next-2', 'other', 'pair-a'])

    // `load` does not keep a request alive once `want` drops it.
    find(pending, 'next-2').onProgress(NEARLY_DONE)
    prefetcher.want([], ['next-3'])
    await expect(waitedOn).rejects.toHaveProperty('name', 'AbortError')
    expect(prefetcher.inFlight().sort()).toEqual(['next-2', 'next-3'])

    prefetcher.want(['pair-a'], [])
    find(pending, 'pair-a').resolve(42)
    expect((await prefetcher.load('pair-a')).size).toBe(42)
    expect(started.filter((url) => url === 'pair-a')).toHaveLength(2)
  })

  it('evicts the least recently used bytes beyond its budget, but never a wanted URL', async () => {
    const { fetchBlob, pending } = controlledFetcher()
    const prefetcher = createImagePrefetcher({ concurrency: 4, maxBytes: 250, fetchBlob })
    prefetcher.want([], ['old', 'kept', 'newer'])
    find(pending, 'old').resolve(100)
    find(pending, 'kept').resolve(100)
    find(pending, 'newer').resolve(100)
    await flush()

    prefetcher.want([], ['kept', 'next'])
    find(pending, 'next').resolve(100)
    await flush()

    expect(['old', 'kept', 'newer', 'next'].filter((url) => prefetcher.has(url))).toEqual(['kept', 'next'])
    expect(prefetcher.storedBytes()).toBe(200)
  })
})
