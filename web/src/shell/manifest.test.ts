import { afterEach, describe, expect, it, vi } from 'vitest'

import stubManifest from '../../public/stub/manifest.json'

import { loadLayerData, loadManifest, validateManifest } from './manifest'

afterEach(() => {
  vi.unstubAllGlobals()
})

// -------------------------------------------------------------------------- validateManifest

describe('validateManifest', () => {
  it('accepts the committed stub manifest', () => {
    const manifest = validateManifest(stubManifest)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.scenes).toHaveLength(3)
    expect(manifest.chapters).toHaveLength(2)
    expect(manifest.layers).toHaveLength(4)
    expect(manifest.events.length).toBeGreaterThanOrEqual(6)
    expect(manifest.credits).toHaveLength(2)
  })

  it('rejects a wrong schemaVersion', () => {
    const bad = { ...stubManifest, schemaVersion: 2 }
    expect(() => validateManifest(bad)).toThrow(/schemaVersion/)
  })

  it('rejects a missing schemaVersion', () => {
    const { schemaVersion: _drop, ...rest } = stubManifest as Record<string, unknown>
    expect(() => validateManifest(rest)).toThrow(/schemaVersion/)
  })

  it('rejects a missing required top-level field', () => {
    const { scenes: _drop, ...rest } = stubManifest as Record<string, unknown>
    expect(() => validateManifest(rest)).toThrow(/scenes/)
  })

  it('rejects a scene missing a required field', () => {
    const bad = {
      ...stubManifest,
      scenes: [{ id: 'x', t: 0, chapterId: 'c', image: 'i.svg', caption: 'hi', width: 10, height: 10 }],
    }
    expect(() => validateManifest(bad)).toThrow(/shot/)
  })

  it('rejects an unknown shot type', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          shot: 'DRONE_SHOT',
          caption: 'hi',
          width: 10,
          height: 10,
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/shot/)
  })

  it('rejects a non-object payload', () => {
    expect(() => validateManifest(null)).toThrow()
    expect(() => validateManifest('nope')).toThrow()
    expect(() => validateManifest([])).toThrow()
  })

  it('rejects a layer with a malformed timeDomain', () => {
    const bad = {
      ...stubManifest,
      layers: [
        {
          id: 'x',
          name: 'X',
          surface: 'hud',
          dataKind: 'scalar',
          timeDomain: [0],
          source: 's',
          chartable: true,
          data: 'd.json',
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/timeDomain/)
  })

  it('accepts optional scene and chapter fields when present', () => {
    const withOptionals = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          depth: 'd.png',
          shot: 'GROUND',
          caption: 'hi',
          pinned: 'sha256:abc',
          width: 10,
          height: 10,
        },
      ],
      chapters: [{ id: 'c', label: 'C', tStart: 0, tEnd: 1, anchorImage: 'anchor.svg' }],
    }
    const manifest = validateManifest(withOptionals)
    expect(manifest.scenes[0]?.depth).toBe('d.png')
    expect(manifest.scenes[0]?.pinned).toBe('sha256:abc')
    expect(manifest.chapters[0]?.anchorImage).toBe('anchor.svg')
  })
})

// ------------------------------------------------------------------------------- loadManifest

function mockFetchSequence(responses: Array<{ url: string; status: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = responses.find((r) => r.url === url)
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: match.status >= 200 && match.status < 300,
      status: match.status,
      json: async () => match.body,
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('loadManifest', () => {
  it('loads the primary manifest when present', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])
    const result = await loadManifest()
    expect(result.isStub).toBe(false)
    expect(result.manifest.buildId).toBe(stubManifest.buildId)
  })

  it('falls back to the stub manifest on a 404 and flags it', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 200, body: stubManifest },
    ])
    const result = await loadManifest()
    expect(result.isStub).toBe(true)
    expect(result.manifest.scenes).toHaveLength(3)
  })

  it('throws on a non-404 failure of the primary fetch without trying the stub', async () => {
    const fetchMock = mockFetchSequence([{ url: '/media/manifest.json', status: 500 }])
    await expect(loadManifest()).rejects.toThrow(/500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws on a malformed primary manifest rather than falling back', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: { schemaVersion: 2 } }])
    await expect(loadManifest()).rejects.toThrow(/schemaVersion/)
  })

  it('throws if both the primary and the stub are missing', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 404 },
    ])
    await expect(loadManifest()).rejects.toThrow(/not found/)
  })
})

// ------------------------------------------------------------------------------ loadLayerData

describe('loadLayerData', () => {
  const manifest = validateManifest(stubManifest)

  it('dispatches scalar layers to parseSeriesData', async () => {
    const entry = manifest.layers.find((l) => l.id === 'co2')!
    mockFetchSequence([{ url: '/stub/layers/co2.json', status: 200, body: { id: 'co2', unit: 'ppm', interpolation: 'log-linear', samples: [{ t: 0, value: 1, lower: null, upper: null }] } }])
    const data = await loadLayerData(manifest, entry)
    expect(data).toHaveProperty('samples')
  })

  it('dispatches raster layers to parseRasterData', async () => {
    const entry = manifest.layers.find((l) => l.id === 'paleodem')!
    mockFetchSequence([{ url: '/stub/layers/paleodem.json', status: 200, body: { id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] } }])
    const data = await loadLayerData(manifest, entry)
    expect(data).toHaveProperty('frames')
  })

  it('dispatches node layers to parseTreeData', async () => {
    const entry = manifest.layers.find((l) => l.id === 'lineage')!
    mockFetchSequence([
      {
        url: '/stub/layers/lineage.json',
        status: 200,
        body: { id: 'lineage', nodes: [{ id: 'a', parent: null, label: 'A', tDivergence: 1, representative: null, note: null, citation: null }] },
      },
    ])
    const data = await loadLayerData(manifest, entry)
    expect(data).toHaveProperty('nodes')
  })

  it('throws for an events-kind layer instead of fetching', async () => {
    const eventsEntry = {
      ...manifest.layers[0]!,
      dataKind: 'events' as const,
    }
    await expect(loadLayerData(manifest, eventsEntry)).rejects.toThrow(/Manifest\.events/)
  })
})
