import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLayout } from './ShellLayout'
import styles from './ShellLayout.module.css'

// No global test setup file is configured for this project (see vitest.config.ts), so
// @testing-library/react does not auto-clean between tests — do it explicitly or multiple
// renders in one file collide.
afterEach(() => {
  cleanup()
})

function renderShell({
  calm = false,
  globeExpanded = false,
  chart = <div>CHART_SLOT</div> as ReactNode,
  globeCaption = '',
} = {}) {
  return render(
    <ShellLayout
      scene={<div>SCENE_SLOT</div>}
      globe={<div>GLOBE_SLOT</div>}
      globeCaption={globeCaption}
      readouts={<div>READOUTS_SLOT</div>}
      feed={<div>FEED_SLOT</div>}
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
      'FEED_SLOT',
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

  it('places the reconstruction note below the timeline, alongside Credits in one footer row, not above it next to the caption', () => {
    renderShell()
    const bottom = screen.getByText('TIMELINE_SLOT').closest(`.${styles.bottom}`) as HTMLElement
    expect(bottom).not.toBeNull()
    const children = Array.from(bottom.children)
    const timelineIndex = children.findIndex((el) => el.classList.contains(styles.timeline ?? ''))
    const footerIndex = children.findIndex((el) => el.classList.contains(styles.footer ?? ''))
    expect(timelineIndex).toBeGreaterThanOrEqual(0)
    expect(footerIndex).toBeGreaterThan(timelineIndex)
    const footer = children[footerIndex] as HTMLElement
    expect(footer.contains(screen.getByText(/artistic reconstruction/i))).toBe(true)
    expect(footer.contains(screen.getByText('Credits'))).toBe(true)
  })

  it('never marks the globe or ancestor slots peripheral, so idle calm cannot fade them (regression)', () => {
    renderShell()
    const globeWrap = screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)
    expect(globeWrap?.className.split(' ')).not.toContain(styles.peripheral)
    const ancestorWrap = screen.getByText('ANCESTOR_SLOT').closest(`.${styles.ancestor}`)
    expect(ancestorWrap?.className.split(' ')).not.toContain(styles.peripheral)
  })

  it('still marks the readouts, feed and credits peripheral, so idle calm keeps quieting them', () => {
    renderShell()
    const readoutsWrap = screen.getByText('READOUTS_SLOT').closest(`.${styles.readouts}`)
    expect(readoutsWrap?.className.split(' ')).toContain(styles.peripheral)
    const feedWrap = screen.getByText('FEED_SLOT').closest(`.${styles.feed}`)
    expect(feedWrap?.className.split(' ')).toContain(styles.peripheral)
    expect(screen.getByText('Credits').className.split(' ')).toContain(styles.peripheral)
  })

  it('labels the globe orb "Paleogeography" with no caption active', () => {
    renderShell()
    const label = screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.querySelector(`.${styles.globeLabel}`)
    expect(label?.textContent).toBe('Paleogeography')
  })

  it("replaces the orb's label with the globe's own caption when one is active, never overlapping the orb's own picture (regression: no label on top of the globe)", () => {
    renderShell({ globeCaption: 'Snowball Earth · extent contested' })
    const orb = screen.getByText('GLOBE_SLOT').closest(`.${styles.orb}`)
    const label = screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.querySelector(`.${styles.globeLabel}`)
    expect(label?.textContent).toBe('Snowball Earth · extent contested')
    expect(orb?.contains(label ?? null)).toBe(false)
    expect(screen.getByText('GLOBE_SLOT').closest(`.${styles.globe}`)?.textContent).not.toContain('Paleogeography')
  })

  it("also shows the globe caption in the expanded stage slot — above the timeline, where Globe's own backdrop can't safely place it itself", () => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption?.textContent).toBe('Impact winter')
    // Not inside the .stage's scene-caption slot (which yields to it while the globe is
    // expanded) or inside the orb itself.
    const sceneCaptionSlot = screen.getByText('CAPTION_SLOT').closest(`.${styles.caption}`)
    expect(sceneCaptionSlot?.contains(stageCaption ?? null)).toBe(false)
    const orb = screen.getByText('GLOBE_SLOT').closest(`.${styles.orb}`)
    expect(orb?.contains(stageCaption ?? null)).toBe(false)
  })

  it.each([
    [false, 'polite', null],
    [true, null, 'polite'],
  ])('announces the globe caption from exactly one live region (globeExpanded=%s)', (globeExpanded, orbLive, stageLive) => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded })
    const orbLabel = document.querySelector(`.${styles.globeLabel}`)
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(orbLabel?.getAttribute('aria-live')).toBe(orbLive)
    expect(stageCaption?.getAttribute('aria-live')).toBe(stageLive)
    expect(document.querySelectorAll('[aria-live]').length).toBe(1)
  })

  it('renders nothing in the expanded stage slot with no globe caption active', () => {
    renderShell({ globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption?.textContent).toBe('')
  })
})
