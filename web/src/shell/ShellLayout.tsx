'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

import { CreditsList } from './CreditsList'
import { Panel } from './Panel'
import styles from './ShellLayout.module.css'

export interface ShellLayoutProps {
  /** Full-window backdrop: the generated still, breathing and dissolving. */
  scene: ReactNode
  /** Top-left floating orb: the independent paleogeographic globe (DESIGN §7). */
  globe: ReactNode
  /** The globe's current regime/effect caption (docs/GLOBE.md §7), or `''` for none, sourced
   *  from `Globe`'s `onCaptionChange` — `Globe` itself never draws this, in either state, so it
   *  never overlaps the orb's own picture (the user-reported "label on top of the globe"
   *  issue). Two places, depending on `globeExpanded`:
   *  - minimised: replaces the "Paleogeography" label under the orb while non-empty, falling
   *    back to it otherwise, in a single-line slot whose height never changes as the caption
   *    appears/disappears;
   *  - expanded: shown in the `caption`/`chart` stage above the timeline — the scene caption's
   *    own spot, empty while the globe is expanded (below) — rather than placed by `Globe`'s
   *    own fullscreen backdrop, which has no way to know where the timeline's playhead label
   *    actually sits and so can't reliably avoid it. */
  globeCaption: string
  /** Left edge, below the globe: scalar layer readouts and sparklines (DESIGN §8, §10). */
  readouts: ReactNode
  /** Left edge, below the readouts: the event feed (DESIGN § Event feed) — recently-reached
   *  events as cards, so they surface as playback passes them instead of only on a timeline
   *  hover. The one empty stretch of the periphery on every breakpoint, so it never sits over
   *  the globe orb, the ancestor panel or the scene caption. `<EventFeed>` shows no cards and
   *  no visible text when there is nothing to show, so this slot silently takes up no visible
   *  space at all then. */
  feed: ReactNode
  /** Top-centre: the current time and the eon/era it falls in. */
  title: ReactNode
  /** Beside the title: a small status tag (e.g. stub data), or nothing. */
  badge: ReactNode
  /** Top-right: the ancestor-at-`t` readout (DESIGN §10). */
  ancestor: ReactNode
  /** Bottom-centre, above the timeline: the scene caption as a subtitle. */
  caption: ReactNode
  /** The open layer chart, or `null`. It takes the caption's place above the timeline (the
   *  caption yields while it is open) so the two never overlap. */
  chart: ReactNode | null
  /** Bottom band: the warped timeline with scrub, play and speed controls. */
  timeline: ReactNode
  /** The globe fills the lens: the title and timeline stay above its backdrop, still legible
   *  and scrubbable (watching the continents move is the point), while the rest recedes. */
  globeExpanded: boolean
  /** The event colour legend, passed straight through to the About & credits panel's
   *  `CreditsList` (re-review fix, 2026-09-15 — see `CreditsList.tsx`'s own doc comment for why
   *  `shell` takes this as a prop rather than importing `@/events`'s `EventTagLegend` itself). */
  eventLegend?: ReactNode
}

/**
 * The page frame (DESIGN §8) as an "expedition viewing lens": the scene fills the window, a
 * vignette darkens it into near-black at the edges, and every piece of UI floats unboxed in
 * that darkened periphery. Every area is a plain slot — this component owns layout and
 * chrome only, never the content or data inside a slot.
 */
export function ShellLayout({
  scene,
  globe,
  globeCaption,
  readouts,
  feed,
  title,
  badge,
  ancestor,
  caption,
  chart,
  timeline,
  globeExpanded,
  eventLegend,
}: ShellLayoutProps) {
  // The About & credits panel (VISUAL_SPEC §9, ADR-012 amendment): local, ShellLayout-owned UI
  // state, not lifted to the `t` store — like the credits link it replaces, this is pure chrome
  // with no bearing on playback or the timeline. No explicit focus wiring needed on either
  // side: `Panel` captures `document.activeElement` (the button, mid-click) on mount and
  // restores it on unmount by itself, and defaults its own initial focus to its dialog root.
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className={styles.shell} data-chart-open={chart !== null} data-globe-expanded={globeExpanded}>
      <div className={styles.scene}>{scene}</div>
      <div className={styles.lens} aria-hidden="true" />

      <div className={styles.hud}>
        <div className={styles.globe}>
          {/* Top-left corner, above the orb: small and muted so it reads as a corner
              affordance, not a competing headline (item 5). In-flow rather than fixed-position —
              it shares this column's flex stack with the orb and its label, so the row simply
              grows to fit it instead of needing a hand-tuned pixel reservation. (An earlier note
              here compared this to a "fixed-position sound toggle" that needed a reservation
              from `.ancestor` opposite it — stale: the sound toggle moved into the timeline
              transport in the same follow-up pass, follow-up item 2, and never came back as a
              fixed-position element.) */}
          <button
            type="button"
            className={styles.aboutButton}
            aria-haspopup="dialog"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen(true)}
          >
            About &amp; credits
          </button>
          <div className={styles.orb}>{globe}</div>
          {/* While expanded, `.expandedGlobeCaption` announces the caption; one live region at a time. */}
          <span className={`${styles.label} ${styles.globeLabel}`} aria-live={globeExpanded ? undefined : 'polite'}>
            {globeCaption !== '' ? globeCaption : 'Paleogeography'}
          </span>
        </div>

        <div className={styles.readouts}>{readouts}</div>

        <div className={styles.feed}>{feed}</div>

        <header className={styles.title}>
          {title}
          {badge}
        </header>

        <div className={styles.ancestor}>
          <span className={styles.label}>Your ancestor</span>
          {ancestor}
        </div>

        <div className={styles.bottom}>
          <div className={styles.stage}>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.chart}>{chart}</div>
            <div className={styles.expandedGlobeCaption} aria-live={globeExpanded ? 'polite' : undefined}>
              {globeCaption}
            </div>
          </div>
          <div className={styles.timeline}>{timeline}</div>
        </div>
      </div>

      {aboutOpen && (
        <Panel label="About & credits" onClose={() => setAboutOpen(false)}>
          <CreditsList eventLegend={eventLegend} />
        </Panel>
      )}
    </div>
  )
}
