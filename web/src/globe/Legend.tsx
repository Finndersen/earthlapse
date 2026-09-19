'use client'

/**
 * The expanded globe's compact overlay legend/toggle panel (docs/GLOBE.md §10). One row,
 * "Human civilisation", governs the whole layer — arrival arcs, population density and city
 * markers together — rather than a toggle per part. Arrivals carry no colour key; density does,
 * because a density colour is meaningless without a scale, and it rides in the row's `footer`
 * slot. Same toggle idiom as `ViewModeToggle` and the timeline transport controls: small-caps
 * label, a pill of pressed/unpressed buttons, `aria-labelledby` rather than a repeated
 * `aria-label`.
 *
 * A row is omitted entirely, not shown disabled, when its overlay has no data at the current `t`.
 * `Globe.tsx` passes each row's visibility as a boolean it already computes (`hasVisibleArrivals`,
 * `densityHasDataAt`, `citiesHaveDataAt`), so this component stays a pure rendering concern with
 * no `t`-domain knowledge. Toggle state also lives in `Globe.tsx` (`useState`, not persisted).
 * Nothing here fades on inactivity (project rule): every visibility change follows from `t`
 * crossing a domain edge or a viewer pressing a toggle, never an idle timer.
 *
 * `compact` (phone viewports, decided by `Globe.tsx` from the same `useIsPhoneViewport()` it uses
 * for basemap tier, so "phone" means one thing across the feature) strips the panel to a short
 * label above its On/Off pill — no hint text, no density ramp — so it stays narrow enough to sit
 * beside the era shortcuts. `compactLabel` and `compactHint` are separate short strings rather
 * than CSS truncations, because truncating would cut off exactly the honesty caveats
 * ("modelled", "data ends 2015") the hints exist to carry; the hint survives as screen-reader
 * text even where it is not drawn.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'

import styles from './Globe.module.css'

export interface LegendRow {
  id: string
  label: string
  /** A short description shown under the label — the overlay's colour key and any honesty
   *  caveat it carries. */
  hint: string
  /** A one-line alternative to `hint`, shown instead of it when `compact` — never a CSS
   *  truncation of `hint`, so the caveat it carries is never what gets cut off. */
  compactHint: string
  /** A shorter `label` for the compact panel, which is narrow enough that the full name wraps
   *  or runs into the era shortcuts beside it. */
  compactLabel: string
  on: boolean
  onChange: (on: boolean) => void
  /** Optional extra content under the hint — the population-density colour key
   *  (`DensityRampKey.tsx`). A slot rather than a `kind` discriminator, so this component needs no
   *  knowledge of which overlay a row belongs to. Shown in both layouts. */
  footer?: ReactNode
  /** Whether this overlay has data at the current `t`; `false` omits the row entirely rather than
   *  greying it out. */
  visible: boolean
}

interface LegendToggleProps extends Omit<LegendRow, 'id' | 'visible'> {
  compact: boolean
}

function LegendToggle({ label, compactLabel, hint, compactHint, on, onChange, footer, compact }: LegendToggleProps) {
  const labelId = useId()
  // Read by the toggle group below via aria-describedby so a screen reader announces the honesty
  // caveat the hint carries ("modelled", "data ends 2015") right alongside the control, not only
  // as a paragraph a viewer would have to find separately.
  const hintId = useId()
  return (
    <div className={compact ? styles.legendRowCompact : styles.legendRow}>
      <div className={styles.legendRowHeader}>
        <span id={labelId} className={styles.legendRowLabel}>
          {compact ? compactLabel : label}
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
      {/* Compact keeps the hint in the accessibility tree but off the screen: the phone panel is
          title + On/Off only, and the caveat the hint carries ("modelled", "data ends 2015") must
          still reach a screen reader through `aria-describedby` rather than disappearing with the
          pixels. `footer` (the density ramp) has no such text equivalent and is simply dropped. */}
      {compact ? (
        <span id={hintId} className={styles.visuallyHidden}>
          {compactHint}
        </span>
      ) : (
        <>
          <p id={hintId} className={styles.legendHint}>
            {hint}
          </p>
          {footer}
        </>
      )}
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

/** Renders nothing when every row is out of its data domain — an empty legend box is chrome with
 *  nothing to say. Filtering here means `Globe.tsx` passes every row it has and never needs to
 *  know the panel can collapse to nothing.
 *
 *  A row's buttons can vanish under a keyboard user mid-interaction when `t` crosses a domain
 *  edge, and the browser then drops focus onto `<body>` with no indication of where it went.
 *  `hadFocusRef` tracks whether focus was genuinely inside the legend (via the container's
 *  bubbling `onFocus`/`onBlur`); the effect redirects focus back to the container only in that
 *  case, on the render after a row-set change, so focus a viewer moved elsewhere is never stolen. */
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
