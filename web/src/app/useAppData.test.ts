// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LayerManifest, Manifest } from '@/types/manifest'

import stubManifestJson from '../../public/stub/manifest.json'

const { layerLoads } = vi.hoisted(() => ({
  layerLoads: new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>(),
}))

const stubManifest = stubManifestJson as unknown as Manifest

vi.mock('@/shell', () => ({
  loadManifest: vi.fn(async () => ({ manifest: stubManifest, isStub: true })),
  loadLayerData: vi.fn(
    (_manifest: Manifest, entry: LayerManifest) =>
      new Promise((resolve, reject) => {
        layerLoads.set(entry.id, { resolve, reject })
      }),
  ),
}))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { useAppData } from './useAppData'

afterEach(() => {
  layerLoads.clear()
})

describe('useAppData', () => {
  it('is ready with no layer data as soon as the manifest is in', async () => {
    const { result } = renderHook(() => useAppData())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('unreachable')
    expect(result.current.manifest).toBe(stubManifest)
    expect(result.current.isStub).toBe(true)
    expect(result.current.layerData.size).toBe(0)
  })

  it('adds each layer as it lands, never one that has not', async () => {
    const { result } = renderHook(() => useAppData())
    await waitFor(() => expect(layerLoads.size).toBe(stubManifest.layers.length))

    act(() => layerLoads.get('co2')!.resolve({ kind: 'co2' }))

    await waitFor(() => expect(result.current.status === 'ready' && result.current.layerData.size).toBe(1))
    if (result.current.status !== 'ready') throw new Error('unreachable')
    expect([...result.current.layerData.entries()]).toEqual([['co2', { kind: 'co2' }]])
  })

  it('turns into an error when a layer fails, even after the page is ready', async () => {
    const { result } = renderHook(() => useAppData())
    await waitFor(() => expect(layerLoads.size).toBe(stubManifest.layers.length))

    act(() => layerLoads.get('lineage')!.reject(new Error('/stub/layers/lineage.json: fetch failed with status 404')))

    await waitFor(() => expect(result.current.status).toBe('error'))
    if (result.current.status !== 'error') throw new Error('unreachable')
    expect(result.current.error.message).toMatch(/lineage\.json/)
  })
})
