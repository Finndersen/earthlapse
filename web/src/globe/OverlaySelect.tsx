'use client'

/**
 * The globe's one-of-N raster overlay picker: a native `<select>` replacing the old "People"
 * on/off toggle now that a second overlay (cleared land) shares the globe's single overlay slot
 * (`overlay.ts`). A native control, not a custom listbox or icon row, so its closed footprint
 * never grows with N, it gets full keyboard/screen-reader support for free, and the open option
 * list costs zero page space — the accepted trade-off is that the open list is unstyleable OS
 * chrome, so the selected overlay's colour swatch is drawn beside the *closed* control instead.
 *
 * `null` (an explicit "None" option) is the absence of a selection, not a member of
 * `GlobeOverlayKind` — `overlay.ts` deliberately has no `'none'` entry, so the sentinel below
 * exists only at this component's own DOM boundary and is never let leak past `onChange`.
 */

import { useId } from 'react'

import { GLOBE_OVERLAY_KINDS, GLOBE_OVERLAYS, type GlobeOverlayKind } from './overlay'
import { OverlayRampKey } from './OverlayRampKey'
import styles from './OverlaySelect.module.css'

/** Not `''`: an empty string is too easy to confuse with "no value set" elsewhere, where a real
 *  overlay kind is expected. A distinct, unmistakable sentinel keeps the mapping back to `null`
 *  explicit at the one boundary that needs it. */
const NONE_OPTION_VALUE = '__none__'

export interface OverlaySelectProps {
  value: GlobeOverlayKind | null
  onChange: (kind: GlobeOverlayKind | null) => void
  /** The overlays the published manifest actually carries and that have data to draw — the
   *  caller's business, not this component's. */
  available: readonly GlobeOverlayKind[]
  /** Suppresses the ramp key where there is no room for it. */
  compact?: boolean
}

export function OverlaySelect({ value, onChange, available, compact = false }: OverlaySelectProps) {
  const selectId = useId()

  // `value` may be an overlay whose data has not loaded into `available` yet. Rendering it as an
  // option anyway — rather than snapping the select to something else — keeps the control honest:
  // a select whose displayed value disagrees with its own `value` prop would be a lie.
  const optionKinds = GLOBE_OVERLAY_KINDS.filter((kind) => available.includes(kind) || kind === value)

  return (
    <div className={styles.root}>
      <label htmlFor={selectId} className={styles.visuallyHidden}>
        Map overlay
      </label>
      <div className={styles.control}>
        {value !== null && (
          <span
            className={styles.swatch}
            aria-hidden="true"
            style={{ backgroundColor: GLOBE_OVERLAYS[value].swatchHex }}
          />
        )}
        <select
          id={selectId}
          data-testid="overlay-select"
          className={styles.select}
          disabled={available.length === 0}
          value={value ?? NONE_OPTION_VALUE}
          onChange={(e) => {
            const raw = e.target.value
            onChange(raw === NONE_OPTION_VALUE ? null : (raw as GlobeOverlayKind))
          }}
        >
          <option value={NONE_OPTION_VALUE}>None</option>
          {optionKinds.map((kind) => (
            <option key={kind} value={kind}>
              {GLOBE_OVERLAYS[kind].label}
            </option>
          ))}
        </select>
      </div>
      {value !== null && !compact && <OverlayRampKey kind={value} />}
    </div>
  )
}
