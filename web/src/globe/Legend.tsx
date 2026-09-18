'use client'

/**
 * The expanded globe's compact overlay legend/toggle panel (docs/GLOBE.md §10): today one row,
 * "Human civilisation", which governs the whole layer — arrival arcs, population density and city
 * markers together — rather than a toggle and a colour key per part (the user's own framing: "a
 * more global toggle for 'human civilisation' ... which covers that as well as population density
 * and cities"). Arrivals carry no colour key at all; density does, because a density colour is
 * meaningless without a scale, and it rides in the row's own `footer` slot. A labelled toggle in the
 * same idiom as `ViewModeToggle` (`Globe.tsx`) and the timeline transport's "Playback mode"/
 * "Scale" controls — a small-caps label, a pill of pressed/unpressed buttons, `aria-labelledby`
 * rather than a second repeated `aria-label`. A row is omitted entirely (not shown disabled) when
 * its overlay has no data at the current `t` — `Globe.tsx` passes each row's own visibility as a
 * plain boolean it already had to compute anyway (`hasVisibleArrivals` or `densityHasDataAt` or
 * `citiesHaveDataAt`), so this component stays a pure rendering concern with no `t`-domain
 * knowledge of its own.
 *
 * Toggle state itself lives in `Globe.tsx` (`useState`, not persisted — a reasonable follow-up if
 * the product wants `localStorage` persistence for a wider overlay set than this one). Nothing
 * here fades on inactivity (project rule): every visibility change here is a direct consequence
 * of `t` moving past a domain edge or a viewer pressing a toggle, never an idle timer.
 *
 * **`compact`.** On a phone viewport the two-card, multi-line layout took up roughly a third of
 * the screen and pushed everything below it around. Compact rows are single-line — label and
 * toggle side by side, no wrapping description paragraph — and use `compactHint`, a short (one
 * short line, no truncation needed) alternative to the full `hint` rather than truncating the
 * long one with an ellipsis (which would have cut off exactly the honesty caveats, "modelled" /
 * "data ends 2015", those hints exist to carry). `Globe.tsx` decides `compact` from the same
 * `useIsPhoneViewport()` it already reads for basemap tier selection, so "phone" means one thing
 * everywhere in this feature.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

import styles from './Globe.module.css'

export interface LegendRow {
  id: string
  label: string
  /** A short description shown under the label — the overlay's colour key and any honesty
   *  caveat it carries. */
  hint: string
  /** A one-short-line alternative to `hint`, shown instead of it when `compact` (this module's
   *  own doc comment) — never CSS-truncated from the full `hint`, so the caveat it carries is
   *  never the part that gets cut off. */
  compactHint: string
  on: boolean
  onChange: (on: boolean) => void
  /** Optional extra content under the hint — the population-density colour key
   *  (`DensityRampKey.tsx`), since a density colour means nothing without a scale. Kept as a slot
   *  rather than a `kind` discriminator so this component stays a pure rendering concern with no
   *  knowledge of which overlay a row belongs to. Shown in both layouts; the key is already
   *  compact enough not to need a phone variant. */
  footer?: ReactNode
  /** Whether this overlay has data at the current `t` — a row with `visible: false` is omitted
   *  entirely rather than shown greyed out (this module's own doc comment). */
  visible: boolean
}

interface LegendToggleProps extends Omit<LegendRow, 'id' | 'visible'> {
  compact: boolean
}

function LegendToggle({ label, hint, compactHint, on, onChange, footer, compact }: LegendToggleProps) {
  const labelId = useId()
  // Read by the toggle group below via aria-describedby so a screen reader announces the honesty
  // caveat the hint carries ("modelled", "data ends 2015") right alongside the control, not only
  // as a paragraph a viewer would have to find separately.
  const hintId = useId()
  return (
    <div className={compact ? styles.legendRowCompact : styles.legendRow}>
      <div className={styles.legendRowHeader}>
        <span id={labelId} className={styles.legendRowLabel}>
          {label}
        </span>
        <div className={styles.legendToggle} role="group" aria-labelledby={labelId} aria-describedby={hintId}>
          <button type="button" className={styles.legendToggleButton} aria-pressed={on} onClick={() => onChange(true)}>
            On
          </button>
          <button type="button" className={styles.legendToggleButton} aria-pressed={!on} onClick={() => onChange(false)}>
            Off
          </button>
        </div>
      </div>
      <p id={hintId} className={compact ? styles.legendHintCompact : styles.legendHint}>
        {compact ? compactHint : hint}
      </p>
      {footer}
    </div>
  )
}

export interface LegendProps {
  rows: readonly LegendRow[]
  /** Single-line rows, short hints — see this module's own doc comment. Defaults to `false`
   *  (the desktop, multi-line layout) so an existing caller that hasn't opted in is unaffected. */
  compact?: boolean
  /** `Globe.tsx`'s own measurement of this panel's rendered footprint (`useOverlayClearBottom`)
   *  — the expanded sphere/map must never grow underneath it (docs/GLOBE.md's own "must not cover
   *  land" rule). Merged with this component's internal `containerRef` (focus management) via a
   *  callback ref, rather than replacing it, since both need the same node. Optional: a caller
   *  that doesn't need to measure this panel (a test harness) can omit it. */
  boundsRef?: RefObject<HTMLDivElement | null>
}

/** Renders nothing at all when every row is currently out of its data domain — an empty legend
 *  box would just be chrome with nothing to say. Filtering here
 *  keeps `Globe.tsx` from needing to know the panel collapses to nothing; it only ever passes
 *  every row it has and lets this component decide what's currently relevant.
 *
 * **Focus on a row's own disappearance.** A row's "On"/"Off" buttons can
 * vanish out from under a keyboard user mid-interaction — `t` moving past a domain edge flips
 * `visible` to `false` and the row is filtered out entirely, same as above — leaving the browser
 * to drop focus onto `<body>` with no indication of where it went. `hadFocusRef` tracks (via the
 * container's own bubbling `onFocus`/`onBlur`, not a native listener) whether focus was genuinely
 * inside this legend; the effect below redirects it back to the container itself only in that
 * case, on the render after a row set change — never stealing focus a viewer had already moved
 * elsewhere on their own. */
export function Legend({ rows, compact = false, boundsRef }: LegendProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hadFocusRef = useRef(false)
  const visibleRows = rows.filter((row) => row.visible)
  const visibleRowIds = visibleRows.map((row) => row.id).join('\n')

  useEffect(() => {
    const container = containerRef.current
    if (container === null || !hadFocusRef.current) return
    if (!container.contains(document.activeElement)) container.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the row *set*, not the
    // rows array's own identity (Globe.tsx builds a fresh array every render).
  }, [visibleRowIds])

  if (visibleRows.length === 0) return null

  return (
    <div
      ref={(el) => {
        containerRef.current = el
        if (boundsRef) boundsRef.current = el
      }}
      tabIndex={-1}
      className={compact ? styles.legendGroupCompact : styles.legendGroup}
      onFocus={() => {
        hadFocusRef.current = true
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hadFocusRef.current = false
      }}
    >
      {visibleRows.map((row) => (
        <LegendToggle key={row.id} {...row} compact={compact} />
      ))}
    </div>
  )
}
