import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


import { ShellLayout } from './ShellLayout'
import styles from './ShellLayout.module.css'

// No global test setup file is configured for this project (see vitest.config.ts), so
// @testing-library/react does not auto-clean between tests — do it explicitly or multiple
// renders in one file collide.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The About & credits panel loads the manifest itself (`CreditsList`) once opened; stub `fetch`
// so opening it in a test never makes a real network request. The exact credits content is
// `CreditsList.test.tsx`'s concern — these tests only need the panel's own chrome to render.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response),
  )
})

function renderShell({
  globeExpanded = false,
  chart = <div>CHART_SLOT</div> as ReactNode,
  globeCaption = '',
  viewModeToggleHeightPx = 0,
  feedbackLink = undefined as ReactNode,
  sound = undefined as ReactNode,
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
      sound={sound}
      caption={<div>CAPTION_SLOT</div>}
      chart={chart}
      timeline={<div>TIMELINE_SLOT</div>}
      globeExpanded={globeExpanded}
      viewModeToggleHeightPx={viewModeToggleHeightPx}
      feedbackLink={feedbackLink}
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

  // User ask, 2026-09-18: "the extra globe labels when fullscreen like 'Geography unknown',
  // 'Snowball Earth · extent contested' etc can be removed" — scoped to expanded only, per
  // `ShellLayout.tsx`'s own `globeCaption` doc comment. The slot itself stays mounted (it is
  // `useChromeGap`'s own measurement anchor), just always empty while expanded.
  it('never shows the globe caption in the expanded stage slot, however non-empty globeCaption is', () => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded: true })
    const stageCaption = document.querySelector(`.${styles.expandedGlobeCaption}`)
    expect(stageCaption).not.toBeNull()
    expect(stageCaption?.textContent).toBe('')
  })

  it('still shows the globe caption under the minimised orb — only the expanded slot lost it', () => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded: false })
    const orbLabel = document.querySelector(`.${styles.globeLabel}`)
    expect(orbLabel?.textContent).toBe('Impact winter')
  })

  it.each([
    [false, 'polite'],
    [true, null],
  ])('keeps the orb label live only while collapsed (globeExpanded=%s)', (globeExpanded, orbLive) => {
    renderShell({ globeCaption: 'Impact winter', globeExpanded })
    const orbLabel = document.querySelector(`.${styles.globeLabel}`)
    expect(orbLabel?.getAttribute('aria-live')).toBe(orbLive)
  })

  // The expanded stage slot keeps its own `aria-live="polite"` while expanded (unchanged from
  // before this content was removed) even though it now never has anything to announce — an
  // always-empty live region is inert, not a second active announcer, so this is still exactly
  // one *functioning* live region at a time (the orb label's, while collapsed; none while
  // expanded, since there is nothing left to say).
  it('places the sound control at the top of the ancestor column, not in the timeline transport', () => {
    renderShell({ sound: <button type="button" data-testid="sound-slot">sound</button> })
    const ancestorColumn = screen.getByText('ANCESTOR_SLOT').closest(`.${styles.ancestor}`)
    const soundSlot = screen.getByTestId('sound-slot')
    expect(ancestorColumn?.contains(soundSlot)).toBe(true)
    // First in the column, so it lands on the "About & credits" button's row opposite. It is
    // taken out of flow in CSS, so leading the stack costs the panel below no position.
    const children = Array.from(ancestorColumn?.children ?? [])
    expect(children.indexOf(soundSlot.parentElement as Element)).toBe(0)
    expect(screen.getByText('TIMELINE_SLOT').textContent).not.toContain('sound')
  })

  it('renders no sound slot at all when the caller supplies none', () => {
    renderShell()
    expect(screen.queryByTestId('sound-slot')).toBeNull()
  })

  it('never actually has two live regions announcing at once', () => {
    for (const globeExpanded of [false, true]) {
      const { unmount } = renderShell({ globeCaption: 'Impact winter', globeExpanded })
      const liveWithText = Array.from(document.querySelectorAll('[aria-live]')).filter((el) => el.textContent !== '')
      expect(liveWithText.length).toBeLessThanOrEqual(1)
      unmount()
    }
  })
})

// About & credits (VISUAL_SPEC §9, ADR-012 amendment, follow-up item 5): the artistic-
// reconstruction disclosure and the credits list live in an in-experience panel, opened from a
// small top-left corner button, instead of the old always-on footer row and `/credits`
// navigation. No idle-fade of any kind is involved (follow-up item 8) — opening/closing is a
// direct click/Escape/outside-click, never on a timer.
describe('ShellLayout — About & credits panel', () => {
  it('shows a small "About & credits" button and no dialog before it is opened', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the panel on click, leading with the artistic-reconstruction disclosure', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /about & credits/i }))
    expect(screen.getByRole('button', { name: /about & credits/i }).getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/artistic reconstruction/i)
  })

  it('closes on Escape and returns focus to the button (no route change, no route navigated to)', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    // A real click focuses the button before the handler runs (native button activation
    // behaviour); `fireEvent.click` alone doesn't simulate that in jsdom, so focus it first —
    // `Panel` captures whatever has focus at mount and restores it on unmount.
    button.focus()
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('places the button in the top-left globe column, not colliding with the ancestor corner', () => {
    renderShell()
    const button = screen.getByRole('button', { name: /about & credits/i })
    expect(button.closest(`.${styles.globe}`)).not.toBeNull()
    expect(button.closest(`.${styles.ancestor}`)).toBeNull()
  })

  it('threads a caller-supplied feedback link through to the panel content', () => {
    renderShell({ feedbackLink: <a href="https://example.com/issues/new">Report a bug or give feedback</a> })
    fireEvent.click(screen.getByRole('button', { name: /about & credits/i }))
    expect(screen.getByRole('link', { name: /report a bug or give feedback/i })).toBeTruthy()
  })
})

// jsdom applies no layout or media queries, so a rendered assertion can't see which grid area
// or breakpoint rule wins — these read the module's own source instead. Regression coverage
// for the "ancestor sits centred mid-screen on a phone, hiding the scene" bug: the phone rule
// used to give `.ancestor` its own full-width row (`'ancestor ancestor ancestor'`) with
// `justify-self: center`, rather than sharing row 1 with the globe orb and title the way the
// desktop layout already does.
describe('ShellLayout phone ancestor placement (max-width: 760px)', () => {
  const css = readFileSync(path.join(import.meta.dirname, 'ShellLayout.module.css'), 'utf-8')
  const phoneQueryIndex = css.indexOf('@media (max-width: 760px)')
  const phoneBlock = css.slice(phoneQueryIndex, css.indexOf('@media', phoneQueryIndex + 1))

  it('is present in the stylesheet', () => {
    expect(phoneQueryIndex).toBeGreaterThan(-1)
  })

  it('puts the ancestor panel in row 1 beside the globe and title, not its own full-width row', () => {
    const areasMatch = phoneBlock.match(/grid-template-areas:\s*([\s\S]*?);/)
    expect(areasMatch).not.toBeNull()
    const rows = areasMatch![1]!.match(/'[^']*'/g)!.map((row) => row.slice(1, -1).trim())
    expect(rows[0]!.split(/\s+/)).toEqual(['globe', 'title', 'ancestor'])
    expect(rows).not.toContain('ancestor ancestor ancestor')
  })

  it('right-aligns the ancestor corner (mirroring the globe orb top-left) instead of centring it', () => {
    const ancestorRule = phoneBlock.match(/(?<![\w.])\.ancestor\s*\{([^}]*)\}/)
    expect(ancestorRule).not.toBeNull()
    expect(ancestorRule![1]!).toMatch(/justify-self:\s*end/)
    expect(ancestorRule![1]!).not.toMatch(/justify-self:\s*center/)
  })

  // Regression coverage for a follow-up QA pass on the fix above: a long lineage label (e.g.
  // "Homo heidelbergensis / LCA with Neanderthals") spilled out of the corner because the
  // panel's own width was never capped, so its `max-width: 100%` / ellipsis rules (hud.
  // module.css) had nothing to measure against. jsdom applies no layout, so this can only check
  // that the capping rule is present in source, not that text actually elides at a given
  // width — that needs a real browser (Playwright rect check, run ad hoc; not part of this
  // repo's committed toolchain).
  it("caps the ancestor readout panel's own width to the corner, not just its text", () => {
    const panelRule = phoneBlock.match(/\.ancestor\s*>\s*\[data-testid=(['"])ancestor-readout\1\]\s*\{([^}]*)\}/)
    expect(panelRule).not.toBeNull()
    expect(panelRule![2]!).toMatch(/max-width:\s*100%/)
    expect(panelRule![2]!).toMatch(/min-width:\s*0/)
  })

  // Regression coverage for the row-height jump between "no ancestor yet" (before the lineage
  // starts, `<AncestorPortrait>` renders nothing) and "portrait present": row 1 used to grow by
  // the portrait's full height the moment one first appeared, pushing the readouts/feed rows
  // below it down.
  it('holds the ancestor corner at a fixed height so the readouts below it never jump when a portrait first appears', () => {
    const ancestorRule = phoneBlock.match(/(?<![\w.])\.ancestor\s*\{([^}]*)\}/)
    expect(ancestorRule).not.toBeNull()
    expect(ancestorRule![1]!).toMatch(/min-height:/)
  })
})
