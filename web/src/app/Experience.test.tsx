/**
 * W12a integration test: renders the real shell, timeline, layers and scene packages against
 * the committed stub manifest (fetch mocked; the WebGL-dependent `<Globe>` mocked since jsdom
 * has no GPU). Confirms the Definition of Done items that only show up once every package is
 * wired together — see docs/ONESHOT_SCOPE.md.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAssetUrl } from '@/scene'
import { useTimeStore } from '@/store/time'

import co2Data from '../../public/stub/layers/co2.json'
import dayLengthData from '../../public/stub/layers/day_length.json'
import lineageData from '../../public/stub/layers/lineage.json'
import paleodemData from '../../public/stub/layers/paleodem.json'
import stubManifest from '../../public/stub/manifest.json'

vi.mock('@/globe', () => ({
  Globe: () => <div data-testid="globe-mock" />,
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

  // jsdom has no requestAnimationFrame loop worth running here; usePlaybackLoop only needs it
  // not to throw synchronously (playback.playing starts false in every test in this file).
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Waits for the manifest + every layer's data to load and the initial-t effect (opens on the
 *  oldest scene) to have applied, using the archean-shore caption becoming visible as the
 *  settled signal. Scoped to the caption slot: the timeline's checkpoint pips repeat every
 *  scene caption in their hover previews. */
async function renderSettled() {
  render(<Experience />)
  await within(await screen.findByTestId('scene-caption')).findByText(/Archean shore/i)
}

describe('Experience (W12a integration)', () => {
  it(
    'renders a scene image once the stub manifest and layer data have loaded',
    async () => {
      await renderSettled()
      const base = screen.getByTestId('scene-base') as HTMLImageElement
      expect(base.tagName).toBe('IMG')
      expect(base.src).toMatch(/\/stub\/scenes\/.+\.svg$/)
      // The caption follows the dominant scene of SceneView's presented pair, so it can name
      // the archean shore mid-crossfade, before `scene-base` has settled on it — the presented
      // pair rate-limits a jump this large (ADR-012 / `presentation.ts`'s
      // `MIN_TRANSITION_SECONDS`).
      await waitFor(() => expect(base.alt).toMatch(/Archean shore/i), { timeout: 3000, interval: 50 })
    },
    10000,
  )

  it('opens on the oldest scene\'s t, not t=0', async () => {
    await renderSettled()
    expect(useTimeStore.getState().t).toBe(4.0e9)
  })

  it(
    'changes the scene pair when the store t changes',
    async () => {
      await renderSettled()
      const base = screen.getByTestId('scene-base') as HTMLImageElement
      // `renderSettled`'s caption-based signal can fire mid-crossfade, before the scene image
      // has settled (see the rate-limiting note above) — so `before` must capture the image
      // actually having settled on the archean shore, not just the caption having said so.
      await waitFor(() => expect(base.alt).toMatch(/Archean shore/i), { timeout: 3000, interval: 50 })
      const before = base.alt

      act(() => {
        useTimeStore.getState().setT(0)
      })

      // The scene package now rate-limits how fast the *displayed* pair can follow a jump
      // this large (ADR-012 / `presentation.ts`'s `MIN_TRANSITION_SECONDS`), so it settles
      // over real wall-clock time rather than the instant this store update used to produce.
      await waitFor(
        () => {
          const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
          expect(base.alt).not.toBe(before)
          expect(base.alt).toMatch(/modern city/i)
          expect(overlay.alt).toMatch(/modern city/i)
        },
        { timeout: 4000, interval: 50 },
      )
    },
    12000,
  )

  it('shows ~277 ppm for CO2 at t=0', async () => {
    await renderSettled()

    act(() => {
      useTimeStore.getState().setT(0)
    })

    const readout = screen.getByTestId('scalar-readout-co2')
    expect(readout.textContent).toMatch(/277/)
    expect(readout.textContent).toMatch(/ppm/)
  })

  it('shows "no data" for CO2 at t=6e8, beyond its coverage', async () => {
    await renderSettled()

    act(() => {
      useTimeStore.getState().setT(6e8)
    })

    const readout = screen.getByTestId('scalar-readout-co2')
    expect(readout.textContent).toMatch(/no data/i)
  })

  it('titles the lens with the current time and its eon/era', async () => {
    await renderSettled()
    expect(screen.getByTestId('time-title').textContent).toMatch(/Archean/)

    act(() => {
      useTimeStore.getState().setT(0)
    })

    const title = screen.getByTestId('time-title').textContent
    expect(title).toMatch(/present/)
    expect(title).toMatch(/Cenozoic/)
  })

  it(
    'renders the caption through SceneView so it follows the scene pair',
    async () => {
      await renderSettled()

      act(() => {
        useTimeStore.getState().setT(0)
      })

      // Caption and image share SceneView's rate-limited presented pair (ADR-012), so both
      // reach the modern city together once the crossfade has run.
      await waitFor(
        () => {
          const base = screen.getByTestId('scene-base') as HTMLImageElement
          const caption = within(screen.getByTestId('scene-caption'))
          expect(base.alt).toMatch(/modern city/i)
          expect(caption.queryByText(/Archean shore/i)).toBeNull()
          expect(caption.getByText(base.alt).tagName).toBe('P')
        },
        { timeout: 4000, interval: 50 },
      )
    },
    12000,
  )

  it('marks every scene as a timeline checkpoint with its still as the thumbnail', async () => {
    await renderSettled()

    for (const scene of stubManifest.scenes) {
      const pip = screen.getByRole('button', { name: (name) => name.startsWith(`${scene.caption}, `) })
      expect(pip.querySelector('img')?.getAttribute('src')).toBe(resolveAssetUrl(stubManifest.assetBase, scene.image))
    }
  })

  it('changes the ancestor readout across at least 5 t values', async () => {
    await renderSettled()

    const sampledTs = [1e5, 1e7, 1e8, 3e8, 4.5e8, 1e9, 3e9]
    const seen = new Set<string>()

    for (const t of sampledTs) {
      act(() => {
        useTimeStore.getState().setT(t)
      })
      const readout = screen.getByTestId('ancestor-readout')
      seen.add(readout.textContent ?? '')
    }

    expect(seen.size).toBeGreaterThanOrEqual(5)
  })

  describe('event detail (W-followup item 12)', () => {
    // jsdom's getBoundingClientRect defaults to a zero-size box, under which the feed (like the
    // timeline track) treats itself as unmeasured and shows nothing — give its container a real
    // width, as `events/components/EventFeed.test.tsx` does in isolation. Installed before
    // `renderSettled` mounts the tree: `useElementSize` has no ResizeObserver in jsdom, so it
    // only ever reads this once, on mount.
    function mockFeedRect(): () => void {
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 300,
        bottom: 40,
        width: 300,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)
      return () => spy.mockRestore()
    }

    it('surfaces a recently-reached event as a feed card, opening a detail panel on click rather than scrubbing in place', async () => {
      const restoreRect = mockFeedRect()
      await renderSettled()

      act(() => {
        // Exactly kpg-impact's own t (stub manifest): freshest possible, distanceFraction 0.
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
      // "Show on timeline" also closes the panel (re-review fix, 2026-09-15) — it used to leave
      // it open over the very scene the click asked to see.
      expect(screen.queryByRole('dialog')).toBeNull()

      restoreRect()
    })

    it('"Show on timeline" does not resume playback even if it was playing before the panel opened (re-review fix, 2026-09-15)', async () => {
      const restoreRect = mockFeedRect()
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

      const dialog = screen.getByRole('dialog')
      act(() => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Show on timeline' }))
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      // Resuming here would immediately carry the playhead away from the place just asked for.
      expect(useTimeStore.getState().playback.playing).toBe(false)

      restoreRect()
    })

    it('pauses playback on open and resumes it on close, only if it was playing', async () => {
      const restoreRect = mockFeedRect()
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

      restoreRect()
    })

    it('leaves playback paused on close when it was already paused before opening', async () => {
      const restoreRect = mockFeedRect()
      await renderSettled()

      act(() => {
        useTimeStore.getState().setT(66_000_000)
      })
      expect(useTimeStore.getState().playback.playing).toBe(false)

      const card = await screen.findByTestId('event-feed-card-kpg-impact')
      act(() => {
        fireEvent.click(card)
      })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      })
      expect(useTimeStore.getState().playback.playing).toBe(false)

      restoreRect()
    })
  })
})
