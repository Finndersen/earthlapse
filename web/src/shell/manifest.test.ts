import { afterEach, describe, expect, it, vi } from 'vitest'

import stubManifest from '../../public/stub/manifest.json'

import { MAX_PORTRAIT_ZOOM } from '@/types/manifest'

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
      scenes: [
        { id: 'x', t: 0, chapterId: 'c', image: 'i.svg', thumbnail: 'thumb.svg', caption: 'hi', width: 10, height: 10 },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/shot/)
  })

  it('rejects a scene missing thumbnail', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          shot: 'GROUND',
          title: 'Title',
          caption: 'hi',
          width: 10,
          height: 10,
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/thumbnail/)
  })

  it('rejects a scene missing title', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          thumbnail: 'thumb.svg',
          shot: 'GROUND',
          caption: 'hi',
          width: 10,
          height: 10,
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/title/)
  })

  it('parses a scene\'s title', () => {
    const manifest = validateManifest(stubManifest)
    expect(manifest.scenes.map((s) => s.title)).toEqual(['A Modern City', 'Carboniferous Swamp', 'Archean Shore'])
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
          thumbnail: 'thumb.svg',
          shot: 'DRONE_SHOT',
          caption: 'hi',
          width: 10,
          height: 10,
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/shot/)
  })

  it('accepts the SPLIT_LEVEL shot type (ADR-025)', () => {
    const withSplit = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          thumbnail: 'thumb.svg',
          shot: 'SPLIT_LEVEL',
          title: 'Title',
          caption: 'hi',
          width: 10,
          height: 10,
        },
      ],
    }
    expect(validateManifest(withSplit).scenes[0]?.shot).toBe('SPLIT_LEVEL')
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
          thumbnail: 'thumb.svg',
          depth: 'd.png',
          shot: 'GROUND',
          title: 'Title',
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

  it('parses an event\'s additive globe effect (docs/GLOBE.md §6)', () => {
    const withEffect = {
      ...stubManifest,
      events: [
        {
          id: 'k-pg-impact',
          label: 'K-Pg impact',
          tMin: 6.6032e7,
          tMax: 6.6054e7,
          importance: 1.0,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'impact-winter',
            anchor: { lat: 21.3, lon: -89.5 },
            windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
          },
        },
      ],
    }
    const manifest = validateManifest(withEffect)
    expect(manifest.events[0]?.effect).toEqual({
      kind: 'impact-winter',
      anchor: { lat: 21.3, lon: -89.5 },
      windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
    })
  })

  it('leaves effect undefined for an event with no globe visual', () => {
    const manifest = validateManifest(stubManifest)
    for (const event of manifest.events) {
      expect(event.effect).toBeUndefined()
    }
  })

  // ------------------------------------------------------------------------- audio (ADR-023)

  it('defaults audioStems to [] when the field is absent (pre-ADR-023 manifest)', () => {
    const { audioStems: _drop, ...rest } = stubManifest as Record<string, unknown>
    const manifest = validateManifest(rest)
    expect(manifest.audioStems).toEqual([])
  })

  it('parses a published audio stem', () => {
    const withStems = {
      ...stubManifest,
      audioStems: [
        {
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
        },
      ],
    }
    const manifest = validateManifest(withStems)
    expect(manifest.audioStems).toEqual([
      {
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
      },
    ])
  })

  it('rejects an audio stem loop region that ends before it starts', () => {
    const bad = {
      ...stubManifest,
      audioStems: [
        {
          id: 'wind',
          file: 'audio/wind.ogg',
          title: 'Ridge Wind',
          author: 'Test Author',
          licence: 'CC0 1.0',
          sourceUrl: '',
          durationSeconds: 30,
          loopSafe: true,
          levelTrimDb: 0,
          loop: { startSeconds: 20, endSeconds: 10 },
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/loop/)
  })

  it('rejects an audio stem missing a required field', () => {
    const bad = {
      ...stubManifest,
      audioStems: [{ id: 'wind', file: 'audio/wind.ogg' }],
    }
    expect(() => validateManifest(bad)).toThrow(/title/)
  })

  it('parses a scene\'s optional sound', () => {
    const withSound = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          thumbnail: 'thumb.svg',
          shot: 'GROUND',
          title: 'Title',
          caption: 'hi',
          sound: { stem: 'wind', mode: 'loop', gain: 0.5 },
          width: 10,
          height: 10,
        },
      ],
    }
    const manifest = validateManifest(withSound)
    expect(manifest.scenes[0]?.sound).toEqual({ stem: 'wind', mode: 'loop', gain: 0.5 })
  })

  it('leaves sound undefined for a scene with no associated stem', () => {
    // The committed stub gives one scene (`archean-shore`) a `sound` (ADR-023 §3), to exercise
    // the feature end to end against the stub manifest — every other stub scene still has none.
    const manifest = validateManifest(stubManifest)
    const withSound = manifest.scenes.filter((s) => s.sound !== undefined)
    expect(withSound.map((s) => s.id)).toEqual(['archean-shore'])
    for (const scene of manifest.scenes) {
      if (scene.id === 'archean-shore') continue
      expect(scene.sound).toBeUndefined()
    }
  })

  // --------------------------------------------------------------------- location (ADR-034)

  it('parses a scene\'s location, marker included', () => {
    const manifest = validateManifest(stubManifest)
    const holoceneCity = manifest.scenes.find((s) => s.id === 'holocene-city')
    expect(holoceneCity?.location).toEqual({
      label: 'Shenzhen, China',
      presentDay: { lat: 22.54, lon: 114.06 },
      marker: { lat: 22.54, lon: 114.06 },
    })
  })

  it('keeps an explicit null marker as null, never falling back to presentDay', () => {
    const manifest = validateManifest(stubManifest)
    const archeanShore = manifest.scenes.find((s) => s.id === 'archean-shore')
    expect(archeanShore?.location?.marker).toBeNull()
    expect(archeanShore?.location?.presentDay).toEqual({ lat: -21.2, lon: 119.7 })
  })

  it('leaves location absent for a scene with no published place', () => {
    const manifest = validateManifest(stubManifest)
    const swamp = manifest.scenes.find((s) => s.id === 'carboniferous-swamp')
    expect(swamp?.location).toBeUndefined()
  })

  it('rejects an out-of-range latitude on presentDay', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
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
          location: { label: 'Bad', presentDay: { lat: 91, lon: 0 }, marker: null },
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/lat/)
  })

  it('rejects an out-of-range longitude on the marker', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
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
          location: { label: 'Bad', presentDay: { lat: 0, lon: 0 }, marker: { lat: 0, lon: 181 } },
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/lon/)
  })

  // ---------------------------------------------------------------------- framing (ADR-045)

  it('parses a scene\'s framing', () => {
    const withFraming = {
      ...stubManifest,
      scenes: [
        {
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
          framing: { focus: [0.3, 0.6], pan: 180 },
        },
      ],
    }
    const manifest = validateManifest(withFraming)
    expect(manifest.scenes[0]?.framing).toEqual({ focus: [0.3, 0.6], pan: 180 })
  })

  it('leaves framing undefined for a scene with no published framing', () => {
    const manifest = validateManifest(stubManifest)
    for (const scene of manifest.scenes) {
      expect(scene.framing).toBeUndefined()
    }
  })

  it('rejects a focus fraction out of range', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
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
          framing: { focus: [1.2, 0.5], pan: 0 },
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/focus/)
  })

  it('rejects a pan outside [0, 360)', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
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
          framing: { focus: [0.5, 0.5], pan: 360 },
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/pan/)
  })

  function framedStub(framing: unknown): unknown {
    return {
      ...stubManifest,
      scenes: [
        {
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
          framing,
        },
      ],
    }
  }

  it("parses a scene's portrait zoom", () => {
    const manifest = validateManifest(framedStub({ focus: [0.3, 0.6], pan: 180, portraitZoom: 1.3 }))
    expect(manifest.scenes[0]?.framing).toEqual({ focus: [0.3, 0.6], pan: 180, portraitZoom: 1.3 })
  })

  it('accepts a portrait zoom at the cap', () => {
    const manifest = validateManifest(framedStub({ focus: [0.3, 0.6], pan: 0, portraitZoom: MAX_PORTRAIT_ZOOM }))
    expect(manifest.scenes[0]?.framing?.portraitZoom).toBe(MAX_PORTRAIT_ZOOM)
  })

  it.each([0.9, MAX_PORTRAIT_ZOOM + 0.01, Number.NaN])('rejects a portrait zoom of %d', (portraitZoom) => {
    expect(() => validateManifest(framedStub({ focus: [0.5, 0.5], pan: 0, portraitZoom }))).toThrow(/portraitZoom/)
  })

  it('rejects a non-numeric portrait zoom', () => {
    expect(() => validateManifest(framedStub({ focus: [0.5, 0.5], pan: 0, portraitZoom: '1.2' }))).toThrow(
      /portraitZoom/,
    )
  })

  // -------------------------------------------------------------------- features (ADR-035)

  it('accepts the features dataKind on a layer', () => {
    const withFeatureLayer = {
      ...stubManifest,
      layers: [
        ...stubManifest.layers,
        {
          id: 'cities',
          name: 'Cities',
          surface: 'globe',
          dataKind: 'features',
          timeDomain: [0, 4.567e9],
          source: 'cities',
          chartable: false,
          data: 'layers/cities.json',
        },
      ],
    }
    const manifest = validateManifest(withFeatureLayer)
    expect(manifest.layers.find((l) => l.id === 'cities')?.dataKind).toBe('features')
  })

  it('rejects an unknown sound mode', () => {
    const bad = {
      ...stubManifest,
      scenes: [
        {
          id: 'x',
          t: 0,
          chapterId: 'c',
          image: 'i.svg',
          thumbnail: 'thumb.svg',
          shot: 'GROUND',
          title: 'Title',
          caption: 'hi',
          sound: { stem: 'wind', mode: 'fade', gain: 0.5 },
          width: 10,
          height: 10,
        },
      ],
    }
    expect(() => validateManifest(bad)).toThrow(/mode/)
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

  it('rebases the primary manifest onto where it was fetched, not its published assetBase', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 200, body: { ...stubManifest, assetBase: 'https://cdn.example.org' } },
    ])
    const result = await loadManifest()
    expect(result.manifest.assetBase).toBe('/media')
  })

  it('rebases the stub manifest onto /stub', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 200, body: { ...stubManifest, assetBase: 'https://cdn.example.org' } },
    ])
    const result = await loadManifest()
    expect(result.manifest.assetBase).toBe('/stub')
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

  it('dispatches events layers to parseEventsData — docs/GLOBE.md §6, e.g. globe-regimes', async () => {
    const eventsEntry = { ...manifest.layers[0]!, id: 'globe-regimes', dataKind: 'events' as const, data: 'layers/globe-regimes.json' }
    mockFetchSequence([
      {
        url: '/stub/layers/globe-regimes.json',
        status: 200,
        body: {
          id: 'globe-regimes',
          events: [
            {
              id: 'magma-ocean-regime',
              label: 'Magma ocean',
              tMin: 4.35e9,
              tMax: 4.52e9,
              importance: 0.9,
              description: 'd',
              citation: 'c',
              effect: { kind: 'regime-magma-ocean', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
            },
          ],
        },
      },
    ])
    const data = await loadLayerData(manifest, eventsEntry)
    expect(data).toHaveProperty('events')
    expect((data as { events: unknown[] }).events).toHaveLength(1)
  })
})
