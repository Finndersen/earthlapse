import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createNodeLayer } from '../factories'
import { ANCESTOR_DATA, ANCESTOR_MANIFEST } from '../fixtures'
import { indexPortraits } from '../portraits'
import { PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA } from '../portraitFixtures'
import { AncestorPortrait } from './AncestorPortrait'

// jsdom has no WebGL context, so every render here takes the crossfade fallback: two <img>s,
// the older plate at full opacity and the younger over it at the eased alpha.

const layer = createNodeLayer(PORTRAIT_MANIFEST, PORTRAIT_TREE_DATA)
const portraits = indexPortraits(PORTRAIT_TREE_DATA)

function images(container: HTMLElement) {
  const older = container.querySelector<HTMLImageElement>('[data-testid="portrait-older"]')
  const younger = container.querySelector<HTMLImageElement>('[data-testid="portrait-younger"]')
  if (older === null || younger === null) throw new Error('portrait images not rendered')
  return { older, younger }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('<AncestorPortrait>', () => {
  it('renders nothing for a lineage without portraits', () => {
    const { container } = render(
      <AncestorPortrait layer={createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)} t={5e7} assetBase="/media" portraits={null} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing before the oldest plate', () => {
    const { container } = render(<AncestorPortrait layer={layer} t={4.4e9} assetBase="/media" portraits={portraits} />)
    expect(container.innerHTML).toBe('')
  })

  it('crossfades the two plates of a morph band at the eased alpha, resolving URLs against assetBase', () => {
    const t = 6.6e7 // primate's own divergence: the band is centred here, so the mix is 0.5.
    const { container, getByTestId } = render(<AncestorPortrait layer={layer} t={t} assetBase="/media" portraits={portraits} />)

    const { older, younger } = images(container)
    expect(older.getAttribute('src')).toBe('/media/portraits/tetrapod.png')
    expect(younger.getAttribute('src')).toBe('/media/portraits/primate.png')
    expect(older.style.opacity).toBe('1')
    expect(Number(younger.style.opacity)).toBeCloseTo(0.5)
    const figure = getByTestId('ancestor-portrait')
    expect(figure.getAttribute('aria-hidden')).toBe('true')
    expect(figure.dataset.transition).toBe('flow')
  })

  it('marks a pair with no computed morph as a plain crossfade', () => {
    const { getByTestId } = render(<AncestorPortrait layer={layer} t={3.75e8} assetBase="/media" portraits={portraits} />)
    expect(getByTestId('ancestor-portrait').dataset.transition).toBe('crossfade')
  })

  it('rate-limits a jump across a boundary to a visible transition before settling', async () => {
    const { container, rerender } = render(<AncestorPortrait layer={layer} t={1e8} assetBase="/media" portraits={portraits} />)
    expect(images(container).younger.getAttribute('src')).toBe('/media/portraits/tetrapod.png')

    act(() => rerender(<AncestorPortrait layer={layer} t={1e6} assetBase="/media" portraits={portraits} />))
    await new Promise((resolve) => setTimeout(resolve, 250))
    const midway = images(container)
    expect(midway.older.getAttribute('src')).toBe('/media/portraits/tetrapod.png')
    expect(midway.younger.getAttribute('src')).toBe('/media/portraits/primate.png')
    expect(Number(midway.younger.style.opacity)).toBeGreaterThan(0)
    expect(Number(midway.younger.style.opacity)).toBeLessThan(1)

    await waitFor(() => expect(images(container).older.getAttribute('src')).toBe('/media/portraits/primate.png'), {
      timeout: 3000,
      interval: 50,
    })
  }, 10000)
})
