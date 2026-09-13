/**
 * W12a integration test: renders the real shell, timeline, layers and scene packages against
 * the committed stub manifest (fetch mocked; the WebGL-dependent `<Globe>` mocked since jsdom
 * has no GPU). Confirms the Definition of Done items that only show up once every package is
 * wired together — see docs/ONESHOT_SCOPE.md.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
 *  settled signal. */
async function renderSettled() {
  render(<Experience />)
  await screen.findByText(/Archean shore/i)
}

describe('Experience (W12a integration)', () => {
  it('renders a scene image once the stub manifest and layer data have loaded', async () => {
    await renderSettled()
    const base = screen.getByTestId('scene-base') as HTMLImageElement
    expect(base.tagName).toBe('IMG')
    expect(base.src).toMatch(/\/stub\/scenes\/.+\.svg$/)
    // The caption (unlike the <img> src, which SceneView only swaps once the browser has
    // decoded it — see SceneView.tsx's `useDecodedSrc`, and jsdom never fires that decode)
    // reflects the current scene pair immediately, so it is the reliable signal here that the
    // initial scene actually is the oldest one.
    expect(base.alt).toMatch(/Archean shore/i)
  })

  it('opens on the oldest scene\'s t, not t=0', async () => {
    await renderSettled()
    expect(useTimeStore.getState().t).toBe(4.0e9)
  })

  it('changes the scene pair when the store t changes', async () => {
    await renderSettled()
    const before = (screen.getByTestId('scene-base') as HTMLImageElement).alt

    act(() => {
      useTimeStore.getState().setT(0)
    })

    const base = screen.getByTestId('scene-base') as HTMLImageElement
    const overlay = screen.getByTestId('scene-overlay') as HTMLImageElement
    expect(base.alt).not.toBe(before)
    expect(base.alt).toMatch(/modern city/i)
    expect(overlay.alt).toMatch(/modern city/i)
  })

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
})
