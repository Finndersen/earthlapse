import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLayout } from './ShellLayout'

// No global test setup file is configured for this project (see vitest.config.ts), so
// @testing-library/react does not auto-clean between tests — do it explicitly or multiple
// renders in one file collide.
afterEach(() => {
  cleanup()
})

function renderShell({ calm = false, globeExpanded = false, chart = <div>CHART_SLOT</div> as ReactNode } = {}) {
  return render(
    <ShellLayout
      scene={<div>SCENE_SLOT</div>}
      globe={<div>GLOBE_SLOT</div>}
      readouts={<div>READOUTS_SLOT</div>}
      title={<div>TITLE_SLOT</div>}
      badge={<div>BADGE_SLOT</div>}
      ancestor={<div>ANCESTOR_SLOT</div>}
      caption={<div>CAPTION_SLOT</div>}
      chart={chart}
      timeline={<div>TIMELINE_SLOT</div>}
      calm={calm}
      globeExpanded={globeExpanded}
    />,
  )
}

describe('ShellLayout', () => {
  it('renders every slot exactly once', () => {
    renderShell()
    // getByText throws if the text is absent or duplicated, so a successful call is itself
    // the assertion; no @testing-library/jest-dom matcher is installed in this project.
    for (const text of [
      'SCENE_SLOT',
      'GLOBE_SLOT',
      'READOUTS_SLOT',
      'TITLE_SLOT',
      'BADGE_SLOT',
      'ANCESTOR_SLOT',
      'CAPTION_SLOT',
      'CHART_SLOT',
      'TIMELINE_SLOT',
    ]) {
      expect(screen.getByText(text).textContent).toBe(text)
    }
  })

  it('always shows the artistic-reconstruction note (VISUAL_SPEC §9)', () => {
    renderShell()
    expect(screen.getByText(/artistic reconstruction/i).textContent).toMatch(/artistic reconstruction/i)
  })

  it('links to the credits page', () => {
    renderShell()
    const link = screen.getByText('Credits')
    expect(link.getAttribute('href')).toBe('/credits')
  })

  it.each([true, false])('exposes calm=%s on the root for the periphery fade', (calm) => {
    const { container } = renderShell({ calm })
    expect((container.firstElementChild as HTMLElement).dataset.calm).toBe(String(calm))
  })

  it.each([
    [<div key="chart">CHART_SLOT</div>, 'true'],
    [null, 'false'],
  ])('exposes whether a chart is open, so the caption can yield its place (chart %#)', (chart, expected) => {
    const { container } = renderShell({ chart })
    expect((container.firstElementChild as HTMLElement).dataset.chartOpen).toBe(expected)
  })

  it.each([true, false])('exposes globeExpanded=%s on the root', (globeExpanded) => {
    const { container } = renderShell({ globeExpanded })
    expect((container.firstElementChild as HTMLElement).dataset.globeExpanded).toBe(String(globeExpanded))
  })

  it('keeps the reconstruction note outside the caption slot, so it stays while a chart is open', () => {
    renderShell()
    expect(screen.getByText('CAPTION_SLOT').parentElement?.contains(screen.getByText(/artistic reconstruction/i))).toBe(false)
  })
})
