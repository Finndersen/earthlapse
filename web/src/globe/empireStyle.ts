/**
 * The historical-empires layer's look (ADR-059). Pure — hex strings and numbers only — like
 * `humanStyle.ts`, so the canvas painter, the labels and the detail panel read the same constants.
 *
 * **Palette.** Eight categorical hues indexed by a lineage's `colourSlot`. The roster assigns
 * slots by graph colouring, so two lineages that coexist and neighbour each other never share
 * one. The hues sit clear of everything else drawn on the globe in this era: the Natural Earth
 * basemap's olive, tan and ocean blue, the violet-to-pink density ramp, the oxblood-to-rust
 * cleared-land ramp, amber arrival arcs and cyan cities. Every border runs over a dark casing, so
 * each hue needs contrast against the casing rather than against whatever terrain is underneath.
 * No slot is a mid blue: a 1–2 px line of one vanishes against the ocean. Validated with the
 * dataviz palette checker against the casing colour, all pairs: worst CVD separation ΔE 10.1
 * (mint/yellow, protan), worst normal-vision separation ΔE 15.6 (teal/mint), every hue ≥ 3:1
 * against the casing. Slot 1 is a deliberately near-achromatic ice white, the one
 * hue that reads on every backdrop; the labels naming each lineage carry identity as well.
 */

import { TERRITORY_COLOUR_SLOTS } from '@/data/curated'

export const EMPIRE_PALETTE = [
  '#ffe24a', // yellow
  '#e4ecff', // ice white
  '#00e7a0', // mint
  '#ff2d55', // red
  '#9b6bff', // purple
  '#02b5b2', // teal
  '#ff8a00', // orange
  '#f08cff', // orchid
] as const satisfies readonly string[] & { length: typeof TERRITORY_COLOUR_SLOTS }

export function empireColour(colourSlot: number): string {
  return EMPIRE_PALETTE[colourSlot] ?? EMPIRE_PALETTE[0]
}

/** Drawn under every coloured line so outlines hold over pale desert, deep ocean and both
 *  overlay ramps alike. */
export const EMPIRE_CASING = { colour: '#080a0e', alpha: 0.62 } as const

/**
 * Border widths in CSS px. The globe shader draws each border on the territory's edge in screen
 * space (`empireTexture.ts`), so these hold at every zoom, on the orb, the sphere and the map.
 * The casing is centred under the line, a dark half-pixel rim either side.
 */
export const EMPIRE_LINE_WIDTH_PX = 1.25
export const EMPIRE_CASING_WIDTH_PX = 2.25

/** The territory fill's alpha, drawn only while no raster overlay is selected — over density or
 *  cleared land a fill would tint the overlay's own ramp and misreport it. */
export const EMPIRE_FILL_ALPHA = 0.28

/**
 * While one lineage is highlighted (hovered, or its detail panel open) the others recede to
 * `EMPIRE_DIM_ALPHA` of their fill, casing and line alpha, and the highlighted one draws its
 * line `EMPIRE_HIGHLIGHT_LINE_SCALE` times as wide, casing widened to match, over everything
 * else, with a slightly stronger fill.
 */
export const EMPIRE_DIM_ALPHA = 0.45
export const EMPIRE_HIGHLIGHT_LINE_SCALE = 1.6
export const EMPIRE_HIGHLIGHT_FILL_ALPHA = 0.36

/**
 * The equirectangular grid one territory band is rasterised on (`empireTexture.ts` stacks three).
 * Borders are drawn in screen space, so the grid sets only how finely a border follows the
 * geometry: the territory's edge is its coverage's half-way contour, placed to a fraction of a
 * texel. At the map's closest zoom a 2048-wide band is about 4 CSS px per texel. Empires are drawn
 * expanded only: on the ~130 CSS px orb, unlabelled colour regions would only compete with the
 * scene.
 */
export type EmpireTier = 'expanded' | 'expandedHigh'

export interface EmpireTierSpec {
  width: number
  height: number
}

export const EMPIRE_TIERS: Readonly<Record<EmpireTier, EmpireTierSpec>> = {
  expanded: { width: 1536, height: 768 },
  expandedHigh: { width: 2048, height: 1024 },
}

/** The 2048-wide grid only where the GPU can hold the T1 basemap too (`deviceTier.ts`'s
 *  `supportsBasemapT1`), the same ceiling. */
export function selectEmpireTier(highResolutionAvailable: boolean): EmpireTier {
  return highResolutionAvailable ? 'expandedHigh' : 'expanded'
}

/** A label's opacity at rest: legible, a step below full. A hovered or
 *  selected lineage's label draws at full opacity, and while one is, every other label recedes
 *  to `EMPIRE_LABEL_DIM_OPACITY` with its territory. */
export const EMPIRE_LABEL_REST_OPACITY = 0.92
export const EMPIRE_LABEL_DIM_OPACITY = 0.6
