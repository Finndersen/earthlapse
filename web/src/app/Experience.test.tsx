/**
 * Integration test: the real shell, timeline, layers and scene packages against the committed
 * stub manifest, with fetch mocked and the WebGL `<Globe>` stubbed out.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setOnboardingTourOpen } from '@/onboarding'
import { resolveAssetUrl } from '@/scene'
import { useTimeStore } from '@/store/time'

import co2Data from '../../public/stub/layers/co2.json'
import dayLengthData from '../../public/stub/layers/day_length.json'
import lineageData from '../../public/stub/layers/lineage.json'
import paleodemData from '../../public/stub/layers/paleodem.json'
import stubManifest from '../../public/stub/manifest.json'

/** The event the mocked globe reports as activated, standing in for a click on an arrival. */
const GLOBE_ARRIVAL_ID = 'migration-test'

vi.mock('@/globe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/globe')>()),
  Globe: ({ onToggleExpand, onActivateEvent }: { onToggleExpand: () => void; onActivateEvent?: (eventId: string) => void }) => (
    <>
      <button type="button" data-testid="globe-mock" aria-label="Globe stand-in" onClick={onToggleExpand} />
      <button type="button" data-testid="globe-arrival-mock" aria-label="Globe arrival stand-in" onClick={() => onActivateEvent?.(GLOBE_ARRIVAL_ID)} />
    </>
  ),
}))

import { Experience } from './Experience'

const initialStoreState = useTimeStore.getState()

const FETCH_RESPONSES: Record<string, unknown> = {
  '/stub/manifest.json': stubManifest,
  '/stub/layers/co2.json': co2Data,
  '/stub/layers/day_length.json': dayLengthData,
  '/stub/layers/lineage.json': lineageData,
  '/stub/layers/paleodem.json': paleodemData,
}

beforeEach(() => {
  useTimeStore.setState(initialStoreState, true)
  // A returning viewer, so the first-visit tour is not on screen.
  window.localStorage.setItem('earthlapse.onboarding.seen', 'true')

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/media/manifest.json') {
        return { ok: false, status: 404, json: async () => undefined } as Response
      }
      const body = FETCH_RESPONSES[url]
      if (body === undefined) {
        throw new Error(`unexpected fetch in test: ${url}`)
      }
      return { ok: true, status: 200, json: async () => body } as Response
    }),
  )

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  setOnboardingTourOpen(false)
  window.localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Waits until data has loaded and the initial t (the oldest scene) has applied. */
async function renderSettled() {
  render(<Experience />)
  await waitFor(() => expect(screen.getByTestId('scene-caption-text').textContent).toMatch(/Archean shore/i))
}

describe('Experience integration', () => {
  it('shows the first-visit tour only to a new viewer, leaving playback paused', async () => {
    await renderSettled()
    expect(screen.queryByTestId('onboarding-card')).toBeNull()
    cleanup()
    window.localStorage.removeItem('earthlapse.onboarding.seen')
    await renderSettled()
    expect(screen.getByTestId('onboarding-card')).toBeTruthy()
    expect(useTimeStore.getState().playback.playing).toBe(false)
  })

  it('opens on the oldest scene\'s t, not t=0', async () => {
    await renderSettled()
    expect(useTimeStore.getState().t).toBe(4.0e9)
  })

  it('follows a store t change through to the scene, caption, time title and ancestor readout', async () => {
    await renderSettled()
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    expect(screen.getByTestId('time-title').textContent).toMatch(/Archean/)
    const ancestorBefore = screen.getByTestId('ancestor-readout').textContent

    // Drives the scene's rate-limited crossfade from the fake clock rather than real wall time.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    act(() => {
      useTimeStore.getState().setT(0)
    })
    expect(screen.getByTestId('time-title').textContent).toMatch(/present/)
    expect(screen.getByTestId('ancestor-readout').textContent).not.toBe(ancestorBefore)
    expect(screen.queryByTestId('scalar-readout-co2')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(base.alt).toMatch(/modern city/i)
    expect((screen.getByTestId('scene-overlay') as HTMLImageElement).alt).toMatch(/modern city/i)
    expect(within(screen.getByTestId('scene-caption')).queryByText(/Archean shore/i)).toBeNull()
  })

  it(
    "opens the scene's full passage in a panel from the caption's title button, pausing playback until it closes",
    async () => {
      await renderSettled()
      act(() => {
        useTimeStore.getState().setPlaying(true)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Archean Shore — show description' }))
      const dialog = screen.getByRole('dialog', { name: 'Archean Shore' })
      expect(within(dialog).getByTestId('scene-caption-detail').textContent).toMatch(/Archean shore/i)
      expect(useTimeStore.getState().playback.playing).toBe(false)

      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog', { name: 'Archean Shore' })).toBeNull()
      expect(useTimeStore.getState().playback.playing).toBe(true)
    },
    10000,
  )

  it('marks every scene as a timeline checkpoint with its thumbnail', async () => {
    await renderSettled()

    for (const scene of stubManifest.scenes) {
      const pip = screen.getByRole('button', { name: (name) => name.startsWith(`${scene.title}, `) })
      expect(pip.querySelector('img')?.getAttribute('src')).toBe(resolveAssetUrl(stubManifest.assetBase, scene.thumbnail))
    }
  })

  describe('event detail panel', () => {
    it('surfaces a recently-reached event as a feed card, opening a detail panel on click rather than scrubbing in place', async () => {
      await renderSettled()

      act(() => {
        useTimeStore.getState().setT(66_000_000)
      })

      const card = await screen.findByTestId('event-feed-card-kpg-impact')
      expect(card.textContent).toMatch(/impact/i)

      act(() => {
        fireEvent.click(card)
      })

      // Opening the card never moves t by itself — only "Show on timeline" does.
      expect(useTimeStore.getState().t).toBe(66_000_000)
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toMatch(/impact/i)

      act(() => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Show on timeline' }))
      })
      expect(useTimeStore.getState().t).toBe(66_000_000)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('pauses playback while open, resuming it on Close but not on "Show on timeline"', async () => {
      await renderSettled()

      act(() => {
        useTimeStore.getState().setT(66_000_000)
        useTimeStore.getState().setPlaying(true)
      })

      const card = await screen.findByTestId('event-feed-card-kpg-impact')
      act(() => {
        fireEvent.click(card)
      })
      expect(useTimeStore.getState().playback.playing).toBe(false)

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      })
      expect(useTimeStore.getState().playback.playing).toBe(true)

      act(() => {
        fireEvent.click(screen.getByTestId('event-feed-card-kpg-impact'))
      })
      expect(useTimeStore.getState().playback.playing).toBe(false)
      act(() => {
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show on timeline' }))
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(useTimeStore.getState().playback.playing).toBe(false)
    })

    it('opens the event browser from the feed\'s "All events" button, pausing playback until it closes', async () => {
      await renderSettled()
      act(() => {
        useTimeStore.getState().setPlaying(true)
      })
      act(() => {
        fireEvent.click(within(screen.getByTestId('event-feed')).getByRole('button', { name: 'All events' }))
      })
      const browser = screen.getByTestId('event-browser')
      expect(useTimeStore.getState().playback.playing).toBe(false)
      act(() => {
        fireEvent.click(within(browser).getByRole('button', { name: 'Close' }))
      })
      expect(screen.queryByTestId('event-browser')).toBeNull()
      expect(useTimeStore.getState().playback.playing).toBe(true)
    })

    it('returns to the event browser, search kept, when a detail panel opened from one of its rows closes', async () => {
      await renderSettled()
      fireEvent.keyDown(window, { key: '/' })
      fireEvent.change(screen.getByTestId('event-browser-search'), { target: { value: 'a' } })
      act(() => {
        fireEvent.click(within(screen.getAllByRole('option')[0]!).getByRole('button'))
      })
      expect(screen.queryByTestId('event-browser')).toBeNull()
      act(() => {
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
      })
      expect(screen.getByRole('dialog').dataset.testid).toBe('event-browser')
      expect((screen.getByTestId('event-browser-search') as HTMLInputElement).value).toBe('a')
    })

    it('opens a cluster card as a digest of every reached member', async () => {
      // A companion 50 kyr older than kpg-impact clusters under it as headline.
      const manifestWithCluster = {
        ...stubManifest,
        events: [
          ...stubManifest.events,
          {
            id: 'kpg-aftermath-test',
            label: 'Post-impact winter (test fixture)',
            kind: 'moment',
            tMin: 66_050_000,
            tMax: 66_050_000,
            t: 66_050_000,
            tags: ['catastrophe'],
            importance: 0.4,
            description: 'A fixture-only companion event.',
            citation: 'test fixture',
          },
        ],
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input)
          if (url === '/media/manifest.json') {
            return { ok: false, status: 404, json: async () => undefined } as Response
          }
          const body = url === '/stub/manifest.json' ? manifestWithCluster : FETCH_RESPONSES[url]
          if (body === undefined) throw new Error(`unexpected fetch in test: ${url}`)
          return { ok: true, status: 200, json: async () => body } as Response
        }),
      )

      await renderSettled()
      act(() => {
        useTimeStore.getState().setT(66_000_000)
      })

      const card = await screen.findByTestId('event-feed-card-kpg-impact')
      expect(screen.getByTestId('event-feed-more-kpg-impact').textContent).toContain('+1 more')

      act(() => {
        fireEvent.click(card)
      })

      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toMatch(/impact/i)
      expect(dialog.textContent).toContain('Post-impact winter (test fixture)')
      expect(dialog.textContent).toContain('A fixture-only companion event.')
    })
  })

  describe('globe event activation', () => {
    const ORIGIN = {
      id: 'origin-test',
      label: 'Origin arrival (test fixture)',
      kind: 'moment',
      tMin: 300_000,
      tMax: 300_000,
      t: 300_000,
      tags: ['human-origins'],
      importance: 0.5,
      description: 'Where the fixture chain begins.',
      citation: 'test fixture',
      effect: {
        kind: 'arrival',
        arrivalKind: 'peopling',
        origin: { lat: 9, lon: 34 },
        destination: { lat: 9, lon: 34 },
        established: 300_000,
        windows: [{ tMin: 0, tMax: 300_000 }],
      },
    }
    const MIGRATION = {
      id: 'migration-test',
      label: 'Migration arrival (test fixture)',
      kind: 'period',
      tMin: 4_600,
      tMax: 5_000,
      tags: ['human-origins'],
      importance: 0.5,
      description: 'A deliberately long fixture description that the globe tooltip would clamp to three lines.',
      citation: 'test fixture',
      effect: {
        kind: 'arrival',
        arrivalKind: 'migration',
        origin: { lat: 9, lon: 34 },
        destination: { lat: 48, lon: 20 },
        established: 4_600,
        windows: [{ tMin: 0, tMax: 5_000 }],
      },
    }

    function stubManifestWithArrivals(): void {
      const manifest = { ...stubManifest, events: [...stubManifest.events, ORIGIN, MIGRATION] }
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input)
          if (url === '/media/manifest.json') {
            return { ok: false, status: 404, json: async () => undefined } as Response
          }
          const body = url === '/stub/manifest.json' ? manifest : FETCH_RESPONSES[url]
          if (body === undefined) throw new Error(`unexpected fetch in test: ${url}`)
          return { ok: true, status: 200, json: async () => body } as Response
        }),
      )
    }

    it('opens an arrival the globe activates in the detail panel, with its Route, leaving t alone', async () => {
      stubManifestWithArrivals()
      await renderSettled()
      const t = useTimeStore.getState().t
      act(() => {
        fireEvent.click(screen.getByTestId('globe-arrival-mock'))
      })
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Migration arrival (test fixture)')
      expect(within(dialog).getByRole('region', { name: 'Route' }).textContent).toContain('Migration')
      expect(useTimeStore.getState().t).toBe(t)
    })
  })
})

describe('Experience navigation wiring', () => {
  it('enters the Mesozoic from the Dinosaurs era shortcut', async () => {
    await renderSettled()
    fireEvent.click(screen.getByRole('button', { name: /^Dinosaurs —/ }))
    expect(useTimeStore.getState().sectionId).toBe('mesozoic')
    expect(screen.getByRole('navigation', { name: 'Timeline section' }).textContent).toContain('Mesozoic')
  })

  it('expands and collapses the globe through the store', async () => {
    await renderSettled()
    await waitFor(() => expect(screen.getByTestId('globe-mock')).toBeTruthy())
    fireEvent.click(screen.getByTestId('globe-mock'))
    expect(useTimeStore.getState().globeExpanded).toBe(true)
    fireEvent.click(screen.getByTestId('globe-mock'))
    expect(useTimeStore.getState().globeExpanded).toBe(false)
  })

  it('opens the event browser from the / shortcut, pausing playback', async () => {
    await renderSettled()
    act(() => {
      useTimeStore.getState().setPlaying(true)
    })
    fireEvent.keyDown(window, { key: '/' })
    expect(screen.getByTestId('event-browser-search')).toBeTruthy()
    expect(useTimeStore.getState().playback.playing).toBe(false)
  })
})

describe('Experience population readout and chart', () => {
  const POPULATION_ENTRY = {
    id: 'population',
    name: 'Global population',
    surface: 'hud',
    dataKind: 'scalar',
    timeDomain: [10, 12025],
    source: 'hyde',
    chartable: true,
    unit: 'people',
    interpolation: 'log-linear',
    data: 'layers/population.json',
  }
  const POPULATION_DATA = {
    id: 'population',
    unit: 'people',
    interpolation: 'log-linear',
    samples: [
      [10, 7_256_964_920],
      [125, 1_642_028_156],
      [2025, 232_124_272],
      [12025, 4_432_265],
    ].map(([t, value]) => ({ t, value, lower: null, upper: null })),
  }

  beforeEach(() => {
    const responses: Record<string, unknown> = {
      ...FETCH_RESPONSES,
      '/stub/manifest.json': { ...stubManifest, layers: [...stubManifest.layers, POPULATION_ENTRY] },
      '/stub/layers/population.json': POPULATION_DATA,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/media/manifest.json') return { ok: false, status: 404, json: async () => undefined } as Response
        const body = responses[url]
        if (body === undefined) throw new Error(`unexpected fetch in test: ${url}`)
        return { ok: true, status: 200, json: async () => body } as Response
      }),
    )
  })

  it('hides the population readout before its data begins and shows it inside the domain', async () => {
    await renderSettled()
    expect(screen.queryByTestId('scalar-readout-population')).toBeNull()
    act(() => {
      useTimeStore.getState().setT(100)
    })
    expect(screen.getByTestId('scalar-readout-population')).toBeTruthy()
  })
})

describe('Experience layer loading', () => {
  it('renders before every layer has loaded, mounting the globe only once its layers have', async () => {
    let releasePaleodem: () => void = () => {}
    const paleodemHeld = new Promise<void>((resolve) => {
      releasePaleodem = resolve
    })
    const baseFetch = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/stub/layers/paleodem.json') await paleodemHeld
        return baseFetch(input)
      }),
    )

    await renderSettled()
    expect(screen.getByTestId('time-title')).toBeTruthy()
    expect(screen.queryByTestId('globe-mock')).toBeNull()
    expect(screen.queryByText(/No paleogeographic data/)).toBeNull()

    await act(async () => releasePaleodem())

    await waitFor(() => expect(screen.getByTestId('globe-mock')).toBeTruthy())
  })
})
