/**
 * The globe's rough Cenozoic ice age (docs/GLOBE.md §5.1): schematic ice sheets scaled by the
 * LR04-derived ice volume, and shallow shelves exposed by the matching sea-level lowstand. Pure
 * cores (`iceAge.ts`, `iceSheets.ts`, `shelf.ts`) plus the rate-limited hook `Globe.tsx` calls.
 */

export {
  ANTARCTIC_ONSET_T,
  GLACIAL_ICE_CAPTION,
  iceAgeCaption,
  iceAgeLayersFrom,
  type IceAgeLayers,
  type IceAgeState,
  iceAgeStateAt,
  NO_ICE_AGE,
  NORTHERN_ONSET_T,
} from './iceAge'
export { ICE_SHEET_DOME_COUNT, ICE_SHEET_DOMES, ICE_SHEETS_GLSL, writeIceSheetRadii } from './iceSheets'
export { SHELF_GLSL } from './shelf'
export { useIceAge } from './useIceAge'
