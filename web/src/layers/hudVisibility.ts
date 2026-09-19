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
 * Since the row and its click-to-expand chart share one gate in `Experience.tsx`
 * (`HudSparkline`'s `onToggle` only wires up for `hudScalarEntries`), hiding the readout also
 * makes the CO2 chart unreachable from the HUD — intended, not a side effect.
 *
 * To bring a layer back: remove its id from this set. No re-fetch, re-curation, manifest edit,
 * or pipeline change needed.
 */
export const HUD_HIDDEN_LAYER_IDS: ReadonlySet<string> = new Set(['co2'])

/** Whether `layerId` should be excluded from the HUD's scalar readout list — see
 *  `HUD_HIDDEN_LAYER_IDS`. Intended for `Experience.tsx`'s `hudScalarEntries` filter:
 *  `manifest.layers.filter((l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable
 *  && !isHiddenFromHud(l.id))`. */
export function isHiddenFromHud(layerId: string): boolean {
  return HUD_HIDDEN_LAYER_IDS.has(layerId)
}
