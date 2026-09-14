import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA } from '../portraitFixtures'
import { AncestorPanel } from './AncestorPanel'

// jsdom has no WebGL context, so a portrait render here takes the crossfade fallback.

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('<AncestorPanel>', () => {
  it('renders the portrait above the readout under one testid, in the same DOM order every time', () => {
    const layer = createNodeLayer(PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA)
    const { getByTestId } = render(<AncestorPanel layer={layer} t={1e4} assetBase="/media" />)

    const panel = getByTestId('ancestor-readout')
    const portrait = panel.querySelector('[data-testid="ancestor-portrait"]')
    expect(portrait).not.toBeNull()
    expect(panel.textContent).toContain('Homo sapiens')
    // Portrait precedes the text node in document order — it sits above the readout, never
    // interleaved with or below it, regardless of which is present at a given `t`.
    expect(panel.children[0]).toBe(portrait)
  })

  it('still renders the readout, under the same testid, for a lineage with no portraits at all', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    const { getByTestId } = render(<AncestorPanel layer={layer} t={5e7} assetBase="/media" />)

    const panel = getByTestId('ancestor-readout')
    expect(panel.querySelector('[data-testid="ancestor-portrait"]')).toBeNull()
    expect(panel.textContent).toContain('First primate')
  })
})
