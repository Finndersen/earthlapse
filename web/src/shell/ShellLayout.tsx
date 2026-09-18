'use client'

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ERA_SHORTCUTS, formatTimeRange, isEraShortcutActive, type SectionId } from '@/timeline'

import { CreditsList } from './CreditsList'
import { Panel } from './Panel'
import styles from './ShellLayout.module.css'
import { useChromeGap } from './useChromeGap'

/** A restrained line-glyph per shortcut (DESIGN §8: this floats over a photograph, so no filled
 *  icon, no colour of its own — `currentColor` only, matching the caps-mono label beside it).
 *  Deliberately abstract rather than literal so none of the three risks reading as kitsch (the
 *  human's own worry about the dinosaur entry): a globe for the whole planet, a three-toed
 *  fossil track for the dinosaur era, and a plain standing figure for the human one. A `switch`
 *  over `ERA_SHORTCUTS`' own ids, not a lookup table, so a shortcut added without a matching
 *  case throws immediately instead of silently rendering an empty slot. */
function eraShortcutIcon(id: SectionId): ReactNode {
  switch (id) {
    case 'earth':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.1">
          <circle cx="8" cy="8" r="6.5" />
          <ellipse cx="8" cy="8" rx="2.6" ry="6.5" />
          <line x1="1.6" y1="8" x2="14.4" y2="8" />
        </svg>
      )
    case 'mesozoic':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <ellipse cx="8" cy="10.6" rx="3.3" ry="2.8" />
          <ellipse cx="4.5" cy="5.6" rx="1.1" ry="1.8" transform="rotate(-20 4.5 5.6)" />
          <ellipse cx="8" cy="4.4" rx="1.1" ry="2" />
          <ellipse cx="11.5" cy="5.6" rx="1.1" ry="1.8" transform="rotate(20 11.5 5.6)" />
        </svg>
      )
    case 'holocene':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <circle cx="8" cy="3.2" r="1.55" />
          <path d="M8 5.1 V10 M8 6.6 L4.8 8.3 M8 6.6 L11.2 8.3 M8 10 L5.4 14.3 M8 10 L10.6 14.3" />
        </svg>
      )
    default:
      throw new Error(`eraShortcutIcon: no icon for era shortcut '${id}'`)
  }
}

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
  /** The era section the timeline currently shows (ADR-024) — read only to decide which of the
   *  Earth/Dinosaurs/Humans shortcuts below the title reads as selected (`isEraShortcutActive`).
   *  `ShellLayout` never derives a window or citation from this itself; that stays `Timeline`'s
   *  job, the same `sectionId` it already takes. */
  sectionId: SectionId
  /** Fires the same `selectSection` action a section band or breadcrumb click does — see the
   *  Earth/Dinosaurs/Humans shortcut group below the title. Never a second selection mechanism:
   *  every shortcut is a plain alias for an id `Timeline`'s own `sectionById` already knows. */
  onSelectSection: (id: SectionId) => void
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
  sectionId,
  onSelectSection,
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
  const shellRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLElement | null>(null)
  const expandedGlobeCaptionRef = useRef<HTMLDivElement | null>(null)
  useChromeGap(shellRef, titleRef, expandedGlobeCaptionRef)

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

        <header ref={titleRef} className={styles.title}>
          {title}
          {badge}
          {/* The Earth/Dinosaurs/Humans shortcut group (user ask, 2026-09-18): a prominent,
              always-present control, deliberately not folded into the timeline's own already-
              condensed bottom chrome (`Timeline.module.css`'s own recent trim) nor styled like a
              section band or a breadcrumb link — each is its own accent-bordered pill so it
              reads as a shortcut, not as one more geological unit to keep track of. Every entry
              is a plain alias: clicking it calls the exact same `onSelectSection` a band or
              breadcrumb click does, so the result is byte-identical to having navigated there by
              hand (same window, same breadcrumb, same Escape/Up reversal). */}
          <div className={styles.eraShortcuts} role="group" aria-label="Jump to an era" data-testid="era-shortcuts">
            {ERA_SHORTCUTS.map((shortcut) => {
              const active = isEraShortcutActive(shortcut, sectionId)
              // Short form for the accessible name ("Dinosaurs — the Mesozoic"), the exact unit
              // named so the nickname never masquerades as a geological name of its own; the
              // hover `title` adds the section's own cited span for anyone who wants it.
              const unitName = `${shortcut.nickname} — the ${shortcut.section.label}`
              return (
                <button
                  key={shortcut.id}
                  type="button"
                  className={styles.eraShortcut}
                  aria-current={active ? 'location' : undefined}
                  aria-label={unitName}
                  title={`${unitName} (${formatTimeRange(shortcut.section.window)})`}
                  onClick={() => onSelectSection(shortcut.id)}
                >
                  <span className={styles.eraShortcutIcon} aria-hidden="true">
                    {eraShortcutIcon(shortcut.id)}
                  </span>
                  <span className={styles.eraShortcutLabel}>{shortcut.nickname}</span>
                </button>
              )
            })}
          </div>
        </header>

        <div className={styles.ancestor}>
          <span className={styles.label}>Your ancestor</span>
          {ancestor}
        </div>

        <div className={styles.bottom}>
          <div className={styles.stage}>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.chart}>{chart}</div>
            <div
              ref={expandedGlobeCaptionRef}
              className={styles.expandedGlobeCaption}
              aria-live={globeExpanded ? 'polite' : undefined}
            >
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
