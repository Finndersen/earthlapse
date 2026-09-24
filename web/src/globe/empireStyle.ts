/**
 * The historical-empires layer's look (ADR-059). Pure — hex strings and numbers only — like
 * `humanStyle.ts`, so the canvas painter, the labels and the detail panel read the same constants.
 *
 * **Palette.** Eight categorical hues indexed by a lineage's `colourSlot`. The roster assigns
 * slots by graph colouring, so two lineages that coexist and neighbour each other never share
 * one. The hues sit clear of everything else drawn on the globe in this era: the Natural Earth
 * basemap's olive, tan and ocean blue, the violet-to-pink density ramp, the oxblood-to-rust
 * cleared-land ramp, amber arrival arcs and cyan cities. Every stroke runs over a dark casing, so
 * each hue needs contrast against the casing rather than against whatever terrain is underneath.
 * Validated with the dataviz palette checker against the casing colour, all pairs: worst CVD
 * separation ΔE 10.0 (violet/blue, protan), worst normal-vision separation ΔE 15.6 (teal/mint),
 * every hue ≥ 3:1 against the casing. Slot 1 is a deliberately near-achromatic ice white, the one
 * hue that reads on every backdrop; the labels naming each lineage carry identity as well.
 */

import { TERRITORY_COLOUR_SLOTS } from '@/data/curated'

export const EMPIRE_PALETTE = [
  '#ffe24a', // yellow
  '#e4ecff', // ice white
  '#00e7a0', // mint
  '#ff2d55', // red
  '#3a78ff', // blue
  '#02b5b2', // teal
  '#ff8a00', // orange
  '#c08cff', // violet
] as const satisfies readonly string[] & { length: typeof TERRITORY_COLOUR_SLOTS }

export function empireColour(colourSlot: number): string {
  return EMPIRE_PALETTE[colourSlot] ?? EMPIRE_PALETTE[0]
}

/** Drawn under every coloured stroke so outlines hold over pale desert, deep ocean and both
 *  overlay ramps alike. */
export const EMPIRE_CASING_COLOUR = 'rgba(8, 10, 14, 0.62)'

/** The territory fill's alpha, drawn only while no raster overlay is selected — over density or
 *  cleared land a fill would tint the overlay's own ramp and misreport it. */
export const EMPIRE_FILL_ALPHA = 0.28

/**
 * Which canvas an active set is rasterised into. The minimised orb shows the whole hemisphere in
 * about 130 CSS px, so its outlines are several texels wide to survive mip averaging; the expanded
 * map spans about 1000 CSS px, a quarter of a CSS px per texel at 4096 wide, where a 5-texel stroke
 * lands near 1.25 CSS px: clear over olive and tan terrain without reading as a heavy border.
 */
export type EmpireTier = 'orb' | 'expanded' | 'expandedHigh'

export interface EmpireTierSpec {
  width: number
  height: number
  /** Coloured stroke width in texels. */
  stroke: number
  /** Casing width in texels, centred under the stroke. */
  casing: number
}

export const EMPIRE_TIERS: Readonly<Record<EmpireTier, EmpireTierSpec>> = {
  orb: { width: 2048, height: 1024, stroke: 6, casing: 10 },
  expanded: { width: 2048, height: 1024, stroke: 2.5, casing: 4.5 },
  expandedHigh: { width: 4096, height: 2048, stroke: 5, casing: 9 },
}

/** The expanded view uses the 4096-wide canvas only where the GPU can hold the T1 basemap too
 *  (`deviceTier.ts`'s `supportsBasemapT1`), the same ceiling. */
export function selectEmpireTier(expanded: boolean, highResolutionAvailable: boolean): EmpireTier {
  if (!expanded) return 'orb'
  return highResolutionAvailable ? 'expandedHigh' : 'expanded'
}

/** How many lineage labels show at once, expanded only (never on the orb). */
export const EMPIRE_LABEL_CAP_DESKTOP = 6
export const EMPIRE_LABEL_CAP_PHONE = 3

/** A label's opacity at rest: present but quieter than the outlines it names. A hovered or
 *  selected lineage's label draws at full opacity. */
export const EMPIRE_LABEL_REST_OPACITY = 0.75
