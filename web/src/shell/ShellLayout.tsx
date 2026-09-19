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
  /** The globe's current regime/effect caption (docs/GLOBE.md §7), or `''` for none, sourced
   *  from `Globe`'s `onCaptionChange` — `Globe` itself never draws this, in either state, so it
   *  never overlaps the orb's own picture (the user-reported "label on top of the globe"
   *  issue). One place now: the minimised orb's own label, replacing "Paleogeography" while
   *  non-empty, in a single-line slot whose height never changes as the caption appears/
   *  disappears. It used to also show, expanded, in the `caption`/`chart` stage above the
   *  timeline — removed there by user ask, 2026-09-18 ("the extra globe labels when fullscreen
   *  like 'Geography unknown', 'Snowball Earth · extent contested' etc can be removed"); that
   *  slot (`.expandedGlobeCaption`) still exists, empty, purely as `useChromeGap`'s own
   *  measurement anchor — see this component's own doc comment on `expandedGlobeCaptionRef`. */
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
  /** Directly under the title: the Dinosaurs/Humans era shortcuts (`@/timeline`'s
   *  `<EraShortcuts>`). Here rather than in the timeline's own control row so the space below
   *  the track carries only playback controls, and so they sit beside the time readout they
   *  jump. */
  eraShortcuts?: ReactNode
  /** Top-right: the ancestor-at-`t` readout (DESIGN §10). */
  ancestor: ReactNode
  /** The sound mute/volume control (`@/audio`'s `<SoundToggle>`), rendered beneath the ancestor
   *  panel in the same top-right corner column — moved out of the timeline transport row
   *  entirely (`Timeline.tsx`'s own doc comment) so it can never contribute to that row's width
   *  or height. This corner, not a new fixed-position element top-right of its own, because
   *  `.ancestor` already owns the shell's top-right column and simply appending here is the
   *  smallest change to an existing, already-measured layout; it sits after the panel rather than
   *  before it so the panel's own position (tuned to align with the globe orb opposite it) is
   *  undisturbed. Optional so a caller with no audio wired up (tests) can omit it. */
  sound?: ReactNode
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
   *  `onViewModeToggleHeightChange` doc comment) the same way `globeCaption` already crosses this
   *  boundary. Fed to `useChromeGap` as `reserveBottomPx` (plus a fixed clearance margin) so the
   *  expanded sphere/map sizes itself into what is genuinely left over once the toggle's own band
   *  is set aside, rather than growing underneath it (user report: "the globe/map toggle is
   *  overlayed on top of the globe... globe needs to be made a bit smaller"). */
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
  globeCaption,
  readouts,
  feed,
  title,
  badge,
  eraShortcuts,
  ancestor,
  sound,
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
            aria-label="About & credits"
            onClick={() => setAboutOpen(true)}
          >
            <svg className={styles.aboutIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="4.9" r="0.85" fill="currentColor" />
              <path d="M8 7.2v4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {/* "About", not "About & credits": the long label wrapped to two lines in the narrow
                orb column on a phone. The panel it opens is still titled in full, and the
                accessible name below keeps the credits discoverable by name. */}
            About
          </button>
          <div className={styles.orb}>{globe}</div>
          {/* While expanded, `.expandedGlobeCaption` used to announce the caption (one live
              region at a time); it no longer carries any text while expanded at all (below), so
              this is now the *only* live announcer of `globeCaption`, full stop — there is
              nothing left to be mutually exclusive with. */}
          <span
            className={`${styles.label} ${styles.globeLabel}`}
            aria-live={globeExpanded ? undefined : 'polite'}
            data-testid="minimised-globe-label"
          >
            {globeCaption !== '' ? globeCaption : 'Paleogeography'}
          </span>
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
          {sound !== undefined && <div className={styles.ancestorSound}>{sound}</div>}
          <span className={styles.label}>Your ancestor</span>
          {ancestor}
        </div>

        <div className={styles.bottom}>
          <div className={styles.stage}>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.chart}>{chart}</div>
            {/* User ask, 2026-09-18: "the extra globe labels when fullscreen like 'Geography
                unknown', 'Snowball Earth · extent contested' etc can be removed" — scoped to
                *expanded* only (the minimised orb's own label, above, still shows `globeCaption`
                unchanged). This element itself must stay mounted either way: it is `useChromeGap`'s
                own `bottomRef` (this component's own doc comment above has the full "why not
                `.bottom` itself" story), and an empty-but-present element is that reasoning's own
                already-designed-for case ("nothing, when the globe's own caption is empty, exactly
                matching the timeline's own top edge") — this change just makes that the permanent
                state while expanded, rather than only whenever `globeCaption` happened to be `''`.
                `aria-live` stays wired exactly as before (still `'polite'` only while expanded):
                with nothing ever written into it now, it never actually announces anything, which
                is the correct behaviour here — the caption is gone for sighted and screen-reader
                users alike, not just visually hidden from one of them. */}
            {/* Always empty now, not just while collapsed — see the comment above this block.
                `globeCaption` no longer has a reader here at all; the minimised orb's own label
                (above) is its only remaining consumer. */}
            <div
              ref={expandedGlobeCaptionRef}
              className={styles.expandedGlobeCaption}
              aria-live={globeExpanded ? 'polite' : undefined}
              data-testid="expanded-globe-caption"
            />
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
