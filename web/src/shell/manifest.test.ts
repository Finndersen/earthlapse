import { afterEach, describe, expect, it, vi } from 'vitest'

import stubManifest from '../../public/stub/manifest.json'

import { MAX_PORTRAIT_ZOOM } from '@/types/manifest'

import { loadLayerData, loadManifest, validateManifest } from './manifest'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE_SCENE = {
  id: 'x',
  t: 0,
  chapterId: 'c',
  image: 'i.svg',
  thumbnail: 'thumb.svg',
  shot: 'GROUND',
  title: 'Title',
  caption: 'hi',
  width: 10,
  height: 10,
}

function withScene(overrides: Record<string, unknown>): unknown {
  const scene: Record<string, unknown> = { ...BASE_SCENE, ...overrides }
  for (const key of Object.keys(scene)) if (scene[key] === undefined) delete scene[key]
  return { ...stubManifest, scenes: [scene] }
}

function without(key: string): unknown {
  const copy: Record<string, unknown> = { ...stubManifest }
  delete copy[key]
  return copy
}

const STEM = {
  id: 'wind',
  file: 'audio/wind.ogg',
  title: 'Ridge Wind',
  author: 'Test Author',
  licence: 'CC0 1.0',
  sourceUrl: 'https://example.invalid/wind',
  durationSeconds: 30,
  loopSafe: true,
  levelTrimDb: 7.2,
  loop: { startSeconds: 1.5, endSeconds: 28 },
}

describe('validateManifest', () => {
  it('accepts the committed stub manifest', () => {
    const manifest = validateManifest(stubManifest)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.scenes.map((s) => s.title)).toEqual(['A Modern City', 'Carboniferous Swamp', 'Archean Shore'])
    expect(manifest.chapters).toHaveLength(2)
    expect(manifest.layers).toHaveLength(4)
    expect(manifest.credits).toHaveLength(2)
  })

  it('parses optional scene, chapter, stem and layer fields', () => {
    const scene = validateManifest(
      withScene({
        shot: 'SPLIT_LEVEL',
        depth: 'd.png',
        pinned: 'sha256:abc',
        sound: { stem: 'wind', mode: 'loop', gain: 0.5 },
        framing: { focus: [0.3, 0.6], pan: 180, portraitZoom: MAX_PORTRAIT_ZOOM },
      }),
    ).scenes[0]
    expect(scene).toMatchObject({
      shot: 'SPLIT_LEVEL',
      depth: 'd.png',
      pinned: 'sha256:abc',
      sound: { stem: 'wind', mode: 'loop', gain: 0.5 },
      framing: { focus: [0.3, 0.6], pan: 180, portraitZoom: MAX_PORTRAIT_ZOOM },
    })

    const manifest = validateManifest({
      ...stubManifest,
      chapters: [{ id: 'c', label: 'C', tStart: 0, tEnd: 1, anchorImage: 'anchor.svg' }],
      audioStems: [STEM],
      layers: [
        ...stubManifest.layers,
        { id: 'cities', name: 'Cities', surface: 'globe', dataKind: 'features', timeDomain: [0, 4.567e9], source: 'cities', chartable: false, data: 'layers/cities.json' },
      ],
    })
    expect(manifest.chapters[0]?.anchorImage).toBe('anchor.svg')
    expect(manifest.audioStems).toEqual([STEM])
    expect(manifest.layers.find((l) => l.id === 'cities')?.dataKind).toBe('features')
    expect(validateManifest(without('audioStems')).audioStems).toEqual([])
  })

  it("parses an event's globe effect", () => {
    const effect = { kind: 'impact-winter', anchor: { lat: 21.3, lon: -89.5 }, windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }] }
    const manifest = validateManifest({
      ...stubManifest,
      events: [{ id: 'k-pg', label: 'K-Pg', tMin: 6.6032e7, tMax: 6.6054e7, importance: 1, description: 'd', citation: 'c', effect }],
    })
    expect(manifest.events[0]?.effect).toEqual(effect)
  })

  it('parses location with an explicit null marker kept as null', () => {
    const scenes = validateManifest(stubManifest).scenes
    expect(scenes.find((s) => s.id === 'holocene-city')?.location).toEqual({
      label: 'Shenzhen, China',
      presentDay: { lat: 22.54, lon: 114.06 },
      marker: { lat: 22.54, lon: 114.06 },
    })
    expect(scenes.find((s) => s.id === 'archean-shore')?.location?.marker).toBeNull()
    expect(scenes.find((s) => s.id === 'carboniferous-swamp')?.location).toBeUndefined()
  })

  it.each([
    ['a non-object payload', null, /./],
    ['an array payload', [], /./],
    ['a wrong schemaVersion', { ...stubManifest, schemaVersion: 2 }, /schemaVersion/],
    ['a missing schemaVersion', without('schemaVersion'), /schemaVersion/],
    ['a missing top-level field', without('scenes'), /scenes/],
    ['a scene without shot', withScene({ shot: undefined }), /shot/],
    ['a scene without thumbnail', withScene({ thumbnail: undefined }), /thumbnail/],
    ['a scene without title', withScene({ title: undefined }), /title/],
    ['an unknown shot', withScene({ shot: 'DRONE_SHOT' }), /shot/],
    ['an unknown sound mode', withScene({ sound: { stem: 'wind', mode: 'fade', gain: 0.5 } }), /mode/],
    [
      'an out-of-range presentDay latitude',
      withScene({ location: { label: 'Bad', presentDay: { lat: 91, lon: 0 }, marker: null } }),
      /lat/,
    ],
    [
      'an out-of-range marker longitude',
      withScene({ location: { label: 'Bad', presentDay: { lat: 0, lon: 0 }, marker: { lat: 0, lon: 181 } } }),
      /lon/,
    ],
    ['a focus fraction out of range', withScene({ framing: { focus: [1.2, 0.5], pan: 0 } }), /focus/],
    ['a pan of 360', withScene({ framing: { focus: [0.5, 0.5], pan: 360 } }), /pan/],
    ['a portrait zoom below 1', withScene({ framing: { focus: [0.5, 0.5], pan: 0, portraitZoom: 0.9 } }), /portraitZoom/],
    [
      'a portrait zoom above the cap',
      withScene({ framing: { focus: [0.5, 0.5], pan: 0, portraitZoom: MAX_PORTRAIT_ZOOM + 0.01 } }),
      /portraitZoom/,
    ],
    ['a non-numeric portrait zoom', withScene({ framing: { focus: [0.5, 0.5], pan: 0, portraitZoom: '1.2' } }), /portraitZoom/],
    [
      'a malformed layer timeDomain',
      { ...stubManifest, layers: [{ id: 'x', name: 'X', surface: 'hud', dataKind: 'scalar', timeDomain: [0], source: 's', chartable: true, data: 'd.json' }] },
      /timeDomain/,
    ],
    ['an inverted stem loop', { ...stubManifest, audioStems: [{ ...STEM, loop: { startSeconds: 20, endSeconds: 10 } }] }, /loop/],
    ['a stem missing a field', { ...stubManifest, audioStems: [{ id: 'wind', file: 'audio/wind.ogg' }] }, /title/],
  ])('rejects %s', (_label, input, error) => {
    expect(() => validateManifest(input)).toThrow(error)
  })
})

function mockFetch(responses: Array<{ url: string; status: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const match = responses.find((r) => r.url === String(input))
    if (!match) throw new Error(`unexpected fetch: ${String(input)}`)
    return { ok: match.status >= 200 && match.status < 300, status: match.status, json: async () => match.body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('loadManifest', () => {
  const remote = { ...stubManifest, assetBase: 'https://cdn.example.org' }

  it('loads the primary manifest, rebased onto /media', async () => {
    mockFetch([{ url: '/media/manifest.json', status: 200, body: remote }])
    const result = await loadManifest()
    expect(result.isStub).toBe(false)
    expect(result.manifest.assetBase).toBe('/media')
  })

  it('falls back to the stub on a 404, flagged and rebased onto /stub', async () => {
    mockFetch([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 200, body: remote },
    ])
    const result = await loadManifest()
    expect(result.isStub).toBe(true)
    expect(result.manifest.assetBase).toBe('/stub')
  })

  it('throws on a non-404 failure or a malformed primary without trying the stub', async () => {
    const fetchMock = mockFetch([{ url: '/media/manifest.json', status: 500 }])
    await expect(loadManifest()).rejects.toThrow(/500/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    mockFetch([{ url: '/media/manifest.json', status: 200, body: { schemaVersion: 2 } }])
    await expect(loadManifest()).rejects.toThrow(/schemaVersion/)
  })

  it('throws when both primary and stub are missing', async () => {
    mockFetch([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 404 },
    ])
    await expect(loadManifest()).rejects.toThrow(/not found/)
  })
})

describe('loadLayerData', () => {
  const manifest = validateManifest(stubManifest)
  const layer = (id: string) => manifest.layers.find((l) => l.id === id)!

  it.each([
    ['co2', { id: 'co2', unit: 'ppm', interpolation: 'log-linear', samples: [{ t: 0, value: 1, lower: null, upper: null }] }, 'samples'],
    ['paleodem', { id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] }, 'frames'],
    [
      'lineage',
      { id: 'lineage', nodes: [{ id: 'a', parent: null, label: 'A', tDivergence: 1, representative: null, note: null, citation: null }] },
      'nodes',
    ],
  ])('dispatches the %s layer to its shape parser', async (id, body, key) => {
    mockFetch([{ url: `/stub/layers/${id}.json`, status: 200, body }])
    expect(await loadLayerData(manifest, layer(id))).toHaveProperty(key)
  })

  it('dispatches events layers to parseEventsData', async () => {
    const entry = { ...manifest.layers[0]!, id: 'globe-regimes', dataKind: 'events' as const, data: 'layers/globe-regimes.json' }
    mockFetch([
      {
        url: '/stub/layers/globe-regimes.json',
        status: 200,
        body: {
          id: 'globe-regimes',
          events: [{ id: 'm', label: 'M', tMin: 1, tMax: 2, importance: 0.9, description: 'd', citation: 'c', effect: { kind: 'regime-magma-ocean', windows: [{ tMin: 1, tMax: 2 }] } }],
        },
      },
    ])
    expect((await loadLayerData(manifest, entry)) as { events: unknown[] }).toHaveProperty('events', [expect.anything()])
  })
})
