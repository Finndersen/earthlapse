'use client'

/**
 * The expanded globe's overlay legend/toggle panel (docs/GLOBE.md §10), desktop only. One row,
 * "Human civilisation", governs the whole layer — arrival arcs, settlements, city markers and
 * historical-empire territories together (ADR-059) — rather than a toggle per part. Arrivals carry no colour key; density does,
 * because a density colour is meaningless without a scale, and it rides in the row's `footer`
 * slot. Same toggle idiom as `ViewModeToggle` and the timeline transport controls: small-caps
 * label, a pill of pressed/unpressed buttons, `aria-labelledby` rather than a repeated
 * `aria-label`.
 *
 * A row is omitted entirely, not shown disabled, when its overlay has no data at the current `t`.
 * `Globe.tsx` passes each row's visibility as a boolean it already computes (`arrivalsInDomainAt`,
 * `citiesHaveDataAt`, `empiresHaveDataAt`), so this component stays a pure rendering concern with
 * no `t`-domain knowledge. Toggle state also lives in `Globe.tsx` (`useState`, not persisted).
 * Nothing here fades on inactivity (project rule): every visibility change follows from `t`
 * crossing a domain edge or a viewer pressing a toggle, never an idle timer.
 *
 * Phone-only: `Globe.tsx` never renders this component at all (the layer is forced on there
 * instead — nothing to toggle, so no panel). This desktop-only layout used to also serve a
 * `compact` phone variant; that code path is gone along with its last caller.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react'

import styles from './Globe.module.css'

export interface LegendRow {
  id: string
  label: string
  /** A short description shown under the label — the overlay's colour key and any honesty
   *  caveat it carries. */
  hint: string
  on: boolean
  onChange: (on: boolean) => void
  /** Optional extra content under the hint — the population-density colour key
   *  (`DensityRampKey.tsx`). A slot rather than a `kind` discriminator, so this component needs no
   *  knowledge of which overlay a row belongs to. */
  footer?: ReactNode
  /** Whether this overlay has data at the current `t`; `false` omits the row entirely rather than
   *  greying it out. */
  visible: boolean
}

function LegendToggle({ label, hint, on, onChange, footer }: Omit<LegendRow, 'id' | 'visible'>) {
  const labelId = useId()
  // Read by the toggle group below via aria-describedby so a screen reader announces the honesty
  // caveat the hint carries ("modelled", "data ends 2015") right alongside the control, not only
  // as a paragraph a viewer would have to find separately.
  const hintId = useId()
  return (
    <div className={styles.legendRow}>
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
      <p id={hintId} className={styles.legendHint}>
        {hint}
      </p>
      {footer}
    </div>
  )
}

export interface LegendProps {
  rows: readonly LegendRow[]
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
export function Legend({ rows }: LegendProps) {
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
      ref={containerRef}
      tabIndex={-1}
      className={styles.legendGroup}
      onFocus={() => {
        hadFocusRef.current = true
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hadFocusRef.current = false
      }}
    >
      {visibleRows.map((row) => (
        <LegendToggle key={row.id} {...row} />
      ))}
    </div>
  )
}
