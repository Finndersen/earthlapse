'use client'

/**
 * `<AncestorPanel layer t assetBase portraits />` — `<AncestorPortrait>` above
 * `<AncestorReadout>` in one column, for the shell's ancestor slot (DESIGN §10). This is the
 * only place the two are composed: it owns the flex column between them so the portrait's own
 * edge always tracks the text's, whichever way the slot aligns (flex-end at every breakpoint,
 * desktop and phone alike).
 *
 * Without this wrapper, a plain `<div>` here shrink-wraps to its widest child — the portrait
 * plate, or the specimen line below it, whichever is wider at a given `t`. The plate itself
 * has no alignment of its own (a block box just starts flush at that wrapper's near edge), so
 * it only lined up with the slot's fixed edge when the specimen line happened to be no wider
 * than the plate; a longer specimen line (a different ancestor) widened the wrapper and left
 * the plate stranded short of the edge — visibly drifting as `t` scrubbed across ancestors.
 * `align-items: inherit` on `.panel` (matching `<AncestorReadout>`'s own use of it, one level
 * further in) closes that gap: both children — the portrait's fixed-size box and the readout's
 * text — align to the *same* inherited edge as the slot around them, so the portrait's edge is
 * always the slot's edge, independent of any sibling's content width.
 */

import type { GeoTime, Layer, NodeValue } from '@/types/layer'

import type { PortraitIndex } from '../portraits'
import { AncestorPortrait } from './AncestorPortrait'
import { AncestorReadout } from './AncestorReadout'
import styles from './hud.module.css'

export interface AncestorPanelProps {
  layer: Layer<NodeValue>
  t: GeoTime
  assetBase: string
  /** Forwarded to `<AncestorPortrait>` for neighbour preloading only — see its own doc comment. */
  portraits: PortraitIndex | null
}

export function AncestorPanel({ layer, t, assetBase, portraits }: AncestorPanelProps) {
  return (
    <div className={styles.panel} data-testid="ancestor-readout">
      <AncestorPortrait layer={layer} t={t} assetBase={assetBase} portraits={portraits} />
      <AncestorReadout layer={layer} t={t} />
    </div>
  )
}
