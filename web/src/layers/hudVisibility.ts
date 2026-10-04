/**
 * Layer ids suppressed from the HUD readout column even though their manifest entry is
 * `surface: 'hud'`, `dataKind: 'scalar'`, and `chartable: true` — i.e. would otherwise land in
 * `web/src/app/Experience.tsx`'s `hudScalarEntries`.
 *
 * `co2`: display-only exclusion, freeing the vertical space the CO2 row occupied for the event
 * feed — consistent with docs/DECISIONS.md treating CO2 as secondary. Purely a HUD filter:
 * `sources/co2-o2/`, the curated data, the manifest entry (still `surface: 'hud'`), and
 * `createScalarLayer`'s sampling are untouched, and other consumers of `scalarLayers` (e.g.
 * `web/src/audio/engine.ts`'s score filter cutoff) are unaffected.
 *
 * The expanded chart opens from the readout's own sparkline, so hiding the readout also makes the
 * CO2 chart unreachable from the HUD — intended, not a side effect.
 *
 * To bring a layer back: remove its id from this set. No re-fetch, re-curation, manifest edit,
 * or pipeline change needed.
 */
import type { GeoTime } from '@/types/layer'

export const HUD_HIDDEN_LAYER_IDS: ReadonlySet<string> = new Set(['co2'])

/** Whether `layerId` should be excluded from the HUD's scalar readout list — see
 *  `HUD_HIDDEN_LAYER_IDS`. Intended for `Experience.tsx`'s `hudScalarEntries` filter:
 *  `manifest.layers.filter((l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable
 *  && !isHiddenFromHud(l.id))`. */
export function isHiddenFromHud(layerId: string): boolean {
  return HUD_HIDDEN_LAYER_IDS.has(layerId)
}

/** Whether a HUD readout is hidden at `t`: entirely, for any `t` older than its layer's own domain
 *  (population only reaches back into the Holocene, temperature to 482 Ma), rather than showing
 *  "no data" across the rest of deep time, which reads as a load failure. Inside the domain a
 *  declared gap still reads "no record" (`ScalarReadout`). */
export function isReadoutHiddenAt(timeDomain: readonly [GeoTime, GeoTime], t: GeoTime): boolean {
  return t > timeDomain[1]
}

/** Which HUD column a scalar readout sits in: `'globe'` under the globe orb (left), or
 *  `'ancestor'` under the "Your ancestor" panel (right), right-aligned to that column. */
export type HudColumn = 'globe' | 'ancestor'

/** Layers placed somewhere other than the default `'globe'` column. Population reads with the
 *  ancestor panel because both are about people; climate readouts stay with the globe. */
const HUD_COLUMN_BY_LAYER_ID: ReadonlyMap<string, HudColumn> = new Map([['population', 'ancestor']])

export function hudColumnFor(layerId: string): HudColumn {
  return HUD_COLUMN_BY_LAYER_ID.get(layerId) ?? 'globe'
}

/** Whether a column keeps a hidden readout's space. The event feed stacks under the globe
 *  column, so that column holds its height and the feed never moves as readouts come and go; the
 *  ancestor column has nothing below it to displace. */
export const HUD_COLUMN_RESERVES_SPACE: Readonly<Record<HudColumn, boolean>> = { globe: true, ancestor: false }
