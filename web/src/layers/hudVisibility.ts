/**
 * Layer ids suppressed from the HUD readout column even though their manifest entry is
 * `surface: 'hud'`, `dataKind: 'scalar'`, and `chartable: true` — i.e. would otherwise land in
 * `web/src/app/Experience.tsx`'s `hudScalarEntries`.
 *
 * `co2`: display-only exclusion (user, 2026-09-18) to give the event feed the vertical space
 * the CO2 row used to occupy — consistent with docs/DECISIONS.md treating CO2 as secondary
 * ("show 'no record' gaps, don't source extra proxy data"). This does NOT touch the CO2 layer
 * itself: `sources/co2-o2/`, the curated data, the published manifest entry (still
 * `surface: 'hud'`), and `createScalarLayer`'s sampling all stay exactly as they are. Other
 * consumers of the same `scalarLayers` map — notably `web/src/audio/engine.ts`, which reads
 * `scalarLayers.get('co2')` for the score's filter cutoff — are unaffected, because this only
 * gates what `Experience.tsx` puts in the HUD, not what `buildLayers.ts` builds.
 *
 * Because the row and its click-to-expand chart share one gate in `Experience.tsx`
 * (`HudSparkline`'s `onToggle` is only ever wired up for entries in `hudScalarEntries`), hiding
 * the readout also makes the CO2 chart unreachable from the HUD. That is intended here, not a
 * side effect to work around.
 *
 * To bring a layer back on screen: remove its id from this set. Nothing else needs to change —
 * no re-fetch, no re-curation, no manifest edit, no pipeline change.
 */
export const HUD_HIDDEN_LAYER_IDS: ReadonlySet<string> = new Set(['co2'])

/** Whether `layerId` should be excluded from the HUD's scalar readout list — see
 *  `HUD_HIDDEN_LAYER_IDS`. Intended for `Experience.tsx`'s `hudScalarEntries` filter:
 *  `manifest.layers.filter((l) => l.surface === 'hud' && l.dataKind === 'scalar' && l.chartable
 *  && !isHiddenFromHud(l.id))`. */
export function isHiddenFromHud(layerId: string): boolean {
  return HUD_HIDDEN_LAYER_IDS.has(layerId)
}
