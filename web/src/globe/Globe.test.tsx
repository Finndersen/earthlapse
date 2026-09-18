import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './effects/fixtures'
import { Globe, type GlobeProps, type GlobeRasterLayers } from './index'

// jsdom has no WebGL context (`web/src/lib/webgl.test.ts` covers `supportsWebGL()` itself
// returning false there), so every render in this file exercises `GlobeStaticOrb` — the
// no-WebGL fallback path (W-followup item 15/19e). `<Globe>`'s `<Canvas>` mount would otherwise
// throw "Error creating WebGL context" here. The real WebGL path is covered by the Playwright
// check (forcing `getContext` to return non-null), not jsdom, which cannot run a real GPU
// context either way.

afterEach(() => {
  cleanup()
})

const rasterLayers: GlobeRasterLayers = {
  paleodem: { id: 'paleodem', frames: [{ t: 0, ref: 'paleodem/000.png' }] },
  neoproterozoic: null,
  basemapT0: null,
  basemapT1: null,
  populationDensity: null,
}

const EMPTY_FEED_IDS: ReadonlySet<string> = new Set()

function renderGlobe(overrides: Partial<GlobeProps> = {}) {
  const onToggleExpand = vi.fn()
  const onCaptionChange = vi.fn()
  const utils = render(
    <Globe
      t={1e8}
      rasterLayers={rasterLayers}
      assetBase="https://cdn.example.com/build"
      regimeEvents={REGIME_EVENTS}
      effectEvents={EFFECT_EVENTS}
      expanded={false}
      onToggleExpand={onToggleExpand}
      onCaptionChange={onCaptionChange}
      cities={null}
      sceneLocation={null}
      playbackBaseRate={0.02}
      feedEventIds={EMPTY_FEED_IDS}
      hoveredFeedEventId={null}
      {...overrides}
    />,
  )
  return { ...utils, onToggleExpand, onCaptionChange }
}

describe('Globe without WebGL', () => {
  it('renders the static fallback orb instead of throwing on a missing WebGL context', () => {
    renderGlobe()
    expect(screen.getByTestId('globe-static-orb')).toBeTruthy()
  })

  it('keeps the minimised orb layout — halo and expand button still present', () => {
    const { container } = renderGlobe({ expanded: false })
    expect(container.querySelector('[class*="halo"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand globe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse globe' })).toBeNull()
  })

  it('shows a persistent, decorative expand glyph on the minimised orb, not just a hover ring', () => {
    const { container } = renderGlobe({ expanded: false })
    const glyph = container.querySelector('[class*="expandGlyph"]')
    expect(glyph).toBeTruthy()
    // Decorative: the one accessible name for this control stays on `.expandButton` (asserted
    // above) so the glyph must never duplicate or replace it.
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(glyph?.hasAttribute('aria-label')).toBe(false)
  })

  it('keeps the expanded layout — close button present, no expand button or glyph', () => {
    const { container } = renderGlobe({ expanded: true })
    expect(screen.getByRole('button', { name: 'Collapse globe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand globe' })).toBeNull()
    expect(container.querySelector('[class*="expandGlyph"]')).toBeNull()
  })

  it('still toggles expand on a plain click on the minimised orb (no OrbitControls needed)', () => {
    const { onToggleExpand } = renderGlobe({ expanded: false })
    const orb = screen.getByTestId('globe-static-orb').parentElement as HTMLElement
    fireEvent.pointerDown(orb, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(orb, { clientX: 10, clientY: 10 })
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('collapses via the close button when expanded', () => {
    const { onToggleExpand } = renderGlobe({ expanded: true })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse globe' }))
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('still reports a caption — the effects/regime logic is pure and unaffected by WebGL support', () => {
    // k-pg-impact's window (fixtures.ts), where the effects resolver reports an impact-winter
    // caption regardless of whether a WebGL sphere is there to render the flash over.
    const { onCaptionChange } = renderGlobe({ t: 6.604e7 })
    expect(onCaptionChange).toHaveBeenCalled()
    const lastCaption = onCaptionChange.mock.calls.at(-1)?.[0] as string
    expect(lastCaption.length).toBeGreaterThan(0)
  })
})
