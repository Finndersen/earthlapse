import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createRetainedTextureCache, type TextureFetcher } from './retainedTextureCache'

function namedTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture()
  texture.name = url
  return texture
}

function setup(capacity: number): {
  cache: ReturnType<typeof createRetainedTextureCache>
  fetcher: ReturnType<typeof vi.fn<TextureFetcher>>
  disposed: string[]
  loadAll: (...urls: string[]) => Promise<THREE.Texture[]>
} {
  const disposed: string[] = []
  const fetcher = vi.fn<TextureFetcher>(async (url) => {
    const texture = namedTexture(url)
    texture.addEventListener('dispose', () => disposed.push(url))
    return texture
  })
  const cache = createRetainedTextureCache(capacity, fetcher)
  const loadAll = async (...urls: string[]): Promise<THREE.Texture[]> => {
    const textures: THREE.Texture[] = []
    for (const url of urls) textures.push(await cache.load(url))
    return textures
  }
  return { cache, fetcher, disposed, loadAll }
}

describe('createRetainedTextureCache', () => {
  it('loads a URL at most once, including while it is still loading', async () => {
    const { cache, fetcher } = setup(4)

    const [first, second] = await Promise.all([cache.load('a'), cache.load('a')])
    const third = await cache.load('a')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(cache.get('a')).toBe(first)
  })

  it('disposes the least recently used textures once an insert exceeds capacity', async () => {
    const { cache, disposed, loadAll } = setup(2)

    await loadAll('a', 'b', 'c')

    expect(disposed).toEqual(['a'])
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('treats a get as a use, so a just-read texture outlives older ones', async () => {
    const { cache, disposed, loadAll } = setup(2)

    await loadAll('a', 'b')
    cache.get('a')
    await loadAll('c')

    expect(disposed).toEqual(['b'])
  })

  it('never evicts a retained texture, even past capacity', async () => {
    const { cache, disposed, loadAll } = setup(2)
    const [a, b] = await loadAll('a', 'b')

    cache.retain([a!, b!])
    await loadAll('c', 'd')

    expect(disposed).toEqual(['c', 'd'])
    expect(cache.get('a')).toBe(a)
    expect(cache.get('b')).toBe(b)
  })

  it('evicts a released texture on the next insert, not on release', async () => {
    const { cache, disposed, loadAll } = setup(1)
    const [a] = await loadAll('a')
    const release = cache.retain([a!])
    await loadAll('b')
    expect(disposed).toEqual(['b'])

    release()
    expect(disposed).toEqual(['b'])

    await loadAll('c')
    expect(disposed).toEqual(['b', 'a'])
  })

  it('keeps a texture carried from one retained pair to the next through the swap', async () => {
    const { cache, disposed, loadAll } = setup(2)
    const [b, a] = await loadAll('b', 'a')
    const releaseFirstPair = cache.retain([a!, b!])

    releaseFirstPair()
    cache.retain([b!])
    await loadAll('c')

    expect(disposed).toEqual(['a'])
    expect(cache.get('b')).toBe(b)
  })

  it('disposes a texture evicted before it was retained once its holder releases it', async () => {
    const { cache, disposed, loadAll } = setup(1)
    const [a, b] = await loadAll('a', 'b')
    expect(disposed).toEqual(['a'])

    const release = cache.retain([a!])
    release()

    expect(disposed).toEqual(['a', 'a'])
    expect(cache.get('b')).toBe(b)
  })

  it('counts retains, holding a texture until every holder has released it', async () => {
    const { cache, disposed, loadAll } = setup(1)
    const [a] = await loadAll('a')
    const releaseOne = cache.retain([a!])
    const releaseTwo = cache.retain([a!])

    releaseOne()
    releaseOne()
    await loadAll('b')
    expect(disposed).toEqual(['b'])

    releaseTwo()
    await loadAll('c')
    expect(disposed).toEqual(['b', 'a'])
  })

  it('ignores nulls and textures it does not hold', async () => {
    const { cache, disposed, loadAll } = setup(1)

    const release = cache.retain([null, namedTexture('foreign')])
    await loadAll('a', 'b')
    release()

    expect(disposed).toEqual(['a'])
  })

  it('reports progress only to the call that started the load', async () => {
    const fetcher = vi.fn<TextureFetcher>(async (url, onProgress) => {
      onProgress?.(0.5)
      onProgress?.(1)
      return namedTexture(url)
    })
    const cache = createRetainedTextureCache(2, fetcher)
    const starter = vi.fn()
    const joiner = vi.fn()

    await Promise.all([cache.load('a', starter), cache.load('a', joiner)])

    expect(starter.mock.calls).toEqual([[0.5], [1]])
    expect(joiner).not.toHaveBeenCalled()
  })

  it('does not cache a failed load, so the next request tries again', async () => {
    const fetcher = vi
      .fn<TextureFetcher>()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockImplementation(async (url) => namedTexture(url))
    const cache = createRetainedTextureCache(2, fetcher)

    await expect(cache.load('a')).rejects.toThrow('HTTP 503')
    expect(cache.get('a')).toBeUndefined()
    await expect(cache.load('a')).resolves.toBeInstanceOf(THREE.Texture)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
