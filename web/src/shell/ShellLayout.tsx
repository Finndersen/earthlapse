'use client'

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { CreditsList } from './CreditsList'
import { Panel } from './Panel'
import styles from './ShellLayout.module.css'
import { useChromeGap } from './useChromeGap'

/** Real clearance between the expanded globe's own Globe/Map toggle and `.expandedGlobeCaption`
 *  (`viewModeToggleHeightPx`'s own doc comment) — the same "0px reads as touching, not clear"
 *  reasoning `Globe.module.css`'s narrow-viewport rule gives for its own `+ 6px` margin. */
const VIEW_MODE_TOGGLE_CLEARANCE_PX = 12

export interface ShellLayoutProps {
  /** Full-window backdrop: the generated still, breathing and dissolving. */
  scene: ReactNode
  /** Top-left floating orb: the independent paleogeographic globe (DESIGN §7). */
  globe: ReactNode
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
  /** Directly under the title: the Dinosaurs/Humans era shortcuts (`@/timeline`'s
   *  `<EraShortcuts>`). Here rather than in the timeline's own control row so the space below
   *  the track carries only playback controls, and so they sit beside the time readout they
   *  jump. */
  eraShortcuts?: ReactNode
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
  /** The expanded globe's own Globe/Map toggle's real rendered height in CSS px, `0` while it
   *  isn't mounted (collapsed, or no WebGL) — reported up from `Globe.tsx` (its own
   *  `onViewModeToggleHeightChange` doc comment). Fed to `useChromeGap` as `reserveBottomPx`
   *  (plus a fixed clearance margin) so the expanded sphere/map sizes itself into what is
   *  genuinely left over once the toggle's own band is set aside, rather than growing
   *  underneath it. */
  viewModeToggleHeightPx: number
  /** The event colour legend, passed straight through to the About & credits panel's
   *  `CreditsList` (re-review fix, 2026-09-15 — see `CreditsList.tsx`'s own doc comment for why
   *  `shell` takes this as a prop rather than importing `@/events`'s `EventTagLegend` itself). */
  eventLegend?: ReactNode
  /** The "Report a bug or give feedback" link, passed straight through to `CreditsList` the same
   *  way `eventLegend` is — see `CreditsList.tsx`'s own doc comment. */
  feedbackLink?: ReactNode
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
  readouts,
  feed,
  title,
  badge,
  eraShortcuts,
  ancestor,
  caption,
  chart,
  timeline,
  globeExpanded,
  viewModeToggleHeightPx,
  eventLegend,
  feedbackLink,
}: ShellLayoutProps) {
  // The About & credits panel (VISUAL_SPEC §9, ADR-012 amendment): local, ShellLayout-owned UI
  // state, not lifted to the `t` store — like the credits link it replaces, this is pure chrome
  // with no bearing on playback or the timeline. No explicit focus wiring needed on either
  // side: `Panel` captures `document.activeElement` (the button, mid-click) on mount and
  // restores it on unmount by itself, and defaults its own initial focus to its dialog root.
  const [aboutOpen, setAboutOpen] = useState(false)

  // The expanded globe's own real title-to-timeline gap (`Globe.module.css`'s `.orbExpanded`
  // sizing) — measured here, not guessed there, since `.title` and `.expandedGlobeCaption` are
  // this component's own children and `Globe`'s fullscreen backdrop (rendered elsewhere, inside
  // `.globe`) has no way to see them (its own doc comment on why it can't place the caption
  // itself makes the same point for a different element).
  //
  // The lower boundary is `.expandedGlobeCaption` itself, not `.bottom` (a first pass got this
  // wrong, browser-verified regression, 2026-09-17 lead review): `.stage`'s three children
  // (`.caption`, `.chart`, `.expandedGlobeCaption`) sit in the *same* CSS Grid cell so the
  // caption/chart crossfade never reflows, which means `.stage` — and so `.bottom`, which
  // contains it — is always sized to the *tallest* of the three, including whichever is hidden
  // via `opacity: 0` (`ShellLayout.module.css`'s own crossfade rule): `visibility` isn't involved
  // in that sizing, only `opacity`, so the hidden box still occupies its full layout height.
  // While the globe is expanded, the scene's own `.caption` (a heading plus a paragraph, easily
  // taller than the globe's own short regime caption, or empty) is exactly that hidden-but-still-
  // sized sibling — measuring `.bottom`'s own top edge was therefore measuring space reserved for
  // text nobody can see, undershooting the real free area by however much taller the scene
  // caption happens to be. `.expandedGlobeCaption` has no such sibling inflating *it* — `align-
  // items: end` on `.stage` sizes and bottom-aligns each grid-cell child independently within the
  // shared row, so this element's own `getBoundingClientRect().top` reflects only its *own*
  // content (nothing, when the globe's own caption is empty, exactly matching the timeline's own
  // top edge; its own text's height when it isn't) — which is exactly the boundary the expanded
  // globe needs to clear, in either case.
  //
  // The Globe/Map toggle can't use the same "just nest it in an existing measured element" trick
  // (`viewModeToggleHeightPx`'s own doc comment: it isn't this component's own child — it lives
  // inside `Globe`'s own fullscreen backdrop, a sibling subtree), so it goes through
  // `useChromeGap`'s explicit `reserveBottomPx` instead.
  const shellRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLElement | null>(null)
  const expandedGlobeCaptionRef = useRef<HTMLDivElement | null>(null)
  // `0` reservation, not `VIEW_MODE_TOGGLE_CLEARANCE_PX`, while the toggle isn't mounted at all
  // (collapsed, or no WebGL), so a plain `viewModeToggleHeightPx` of `0` never costs the globe
  // height it doesn't need to give up.
  const reserveBottomPx = viewModeToggleHeightPx > 0 ? viewModeToggleHeightPx + VIEW_MODE_TOGGLE_CLEARANCE_PX : 0
  useChromeGap(shellRef, titleRef, expandedGlobeCaptionRef, reserveBottomPx)

  return (
    <div ref={shellRef} className={styles.shell} data-chart-open={chart !== null} data-globe-expanded={globeExpanded}>
      <div className={styles.scene}>{scene}</div>
      <div className={styles.lens} aria-hidden="true" />

      <div className={styles.hud}>
        <div className={styles.globe}>
          <div className={styles.orb}>{globe}</div>
        </div>

        <div className={styles.readouts} data-testid="shell-readouts">
          {readouts}
        </div>

        <div className={styles.feed} data-testid="shell-feed">
          {feed}
        </div>

        <header ref={titleRef} className={styles.title}>
          {title}
          {badge}
          {eraShortcuts !== undefined && <div className={styles.eraShortcuts}>{eraShortcuts}</div>}
        </header>

        <div className={styles.ancestor}>
          <span className={styles.label}>Your ancestor</span>
          {ancestor}
          {/* Below the portrait, so the globe column opposite starts clean at the orb itself —
              in-flow rather than fixed-position, so this column simply grows to fit it. */}
          <button
            type="button"
            className={styles.aboutButton}
            aria-haspopup="dialog"
            aria-expanded={aboutOpen}
            aria-label="About & credits"
            onClick={() => setAboutOpen(true)}
          >
            <svg className={styles.aboutIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="4.9" r="0.85" fill="currentColor" />
              <path d="M8 7.2v4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {/* "About", not "About & credits": the long label wrapped to two lines in the narrow
                ancestor column on a phone. The panel it opens is still titled in full, and the
                accessible name below keeps the credits discoverable by name. */}
            About
          </button>
        </div>

        <div className={styles.bottom}>
          <div className={styles.stage}>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.chart}>{chart}</div>
            {/* Deliberately always empty: the globe draws no regime/effect caption in either
                state. It stays mounted as `useChromeGap`'s `bottomRef` (this component's own doc
                comment has the "why not `.bottom` itself" story), where an empty element measures
                exactly the timeline's own top edge — the boundary the expanded sphere must clear. */}
            <div ref={expandedGlobeCaptionRef} className={styles.expandedGlobeCaption} data-testid="expanded-globe-caption" />
          </div>
          <div className={styles.timeline}>{timeline}</div>
        </div>
      </div>

      {aboutOpen && (
        <Panel label="About & credits" onClose={() => setAboutOpen(false)}>
          <CreditsList eventLegend={eventLegend} feedbackLink={feedbackLink} />
        </Panel>
      )}
    </div>
  )
}
