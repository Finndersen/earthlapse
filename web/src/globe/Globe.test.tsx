import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './effects/fixtures'
import { Globe, type GlobeProps, type GlobeRasterLayers } from './index'

// jsdom has no WebGL, so every render here exercises the static fallback orb.

afterEach(() => {
  cleanup()
})

const rasterLayers: GlobeRasterLayers = {
  paleodem: { id: 'paleodem', frames: [{ t: 0, ref: 'paleodem/000.png' }] },
  neoproterozoic: null,
  basemapT0: null,
  basemapT1: null,
  overlayRasters: new Map(),
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
      iceAgeLayers={null}
      expanded={false}
      onToggleExpand={onToggleExpand}
      onCaptionChange={onCaptionChange}
      cities={null}
      sceneLocation={null}
      playbackBaseRate={0.02}
      cityLabelFadeWindowAt={() => 150}
      feedEventIds={EMPTY_FEED_IDS}
      hoveredFeedEventId={null}
      {...overrides}
    />,
  )
  return { ...utils, onToggleExpand, onCaptionChange }
}

describe('Globe without WebGL', () => {
  it('renders the fallback orb, expanding on the click after a still press, not on pointerup', () => {
    const { onToggleExpand } = renderGlobe({ expanded: false })
    expect(screen.getByRole('button', { name: 'Expand globe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse globe' })).toBeNull()
    const orb = screen.getByTestId('globe-static-orb').parentElement as HTMLElement
    fireEvent.pointerDown(orb, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(orb, { clientX: 10, clientY: 10 })
    expect(onToggleExpand).not.toHaveBeenCalled()
    fireEvent.click(orb)
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('collapses from the close button when expanded', () => {
    const { onToggleExpand } = renderGlobe({ expanded: true })
    expect(screen.queryByRole('button', { name: 'Expand globe' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse globe' }))
    expect(onToggleExpand).toHaveBeenCalledTimes(1)
  })

  it('still reports effect captions', () => {
    const { onCaptionChange } = renderGlobe({ t: 6.604e7 })
    expect((onCaptionChange.mock.calls.at(-1)?.[0] as string).length).toBeGreaterThan(0)
  })
})
