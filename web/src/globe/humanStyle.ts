/**
 * The human-civilisation layer's shared look: how far its overlays sit above the surface, and the
 * one place each of its colours is written. Pure — hex strings and numbers only, no three.js — so
 * a shader uniform, an instanced vertex attribute, a CSS gradient stop and a tooltip swatch can
 * all read the same constant instead of three hand-kept copies drifting apart.
 *
 * The layer has four visual registers and they are deliberately far apart in hue, because they
 * routinely overlap: an arrival arc crosses land that already carries the density overlay, and a
 * city dot sits on top of both.
 * - **arrivals** warm amber — the HUD's own accent (`--hud-accent`), so a moving arc reads as the
 *   same "this is happening now" register as the rest of the chrome;
 * - **inhabited** a quiet bone white, dimmer than an arc: marks a settlement as it takes hold,
 *   then fades once the arrival has read as an event that happened — it does not persist to the
 *   present (docs/GLOBE.md §10);
 * - **cities** cool cyan, the one hue neither the terrain (greens, tans, blues) nor the density
 *   ramp (violet through hot pink to near-white, `density.ts`'s `DENSITY_RAMP`) occupies;
 * - **scene location** near-white, brightest of the four, because it marks the one place the
 *   current picture is actually of.
 */

/** Fraction of the globe radius an overlay is lifted above the sphere, and the `+z` offset that
 *  keeps it off the flattened map's own plane. Markers sit a hair above arcs so a destination dot
 *  is never half-buried in the ribbon that lands on it. See `projection.ts`'s
 *  `unfoldedLiftedPosition` for why the two modes need separate numbers rather than one inflated
 *  radius. */
export const ARC_SPHERE_LIFT = 0.012
export const ARC_MAP_LIFT = 0.01
export const MARKER_SPHERE_LIFT = 0.016
export const MARKER_MAP_LIFT = 0.014

/** An arc in flight, and the brighter head of the pulse travelling along it. */
export const ARRIVAL_COLOR = '#e8b06a'
export const ARRIVAL_PULSE_COLOR = '#ffe4b8'
/** A traced chain's ghosted arcs (§3 of the human-civilisation brief) — the arrival hue, drained
 *  toward the HUD's own ink so a ghost never competes with a live arc. */
export const ARRIVAL_GHOST_COLOR = '#cdbda0'
/** The transient marker a `peopling` arrival leaves at its destination — fades out once the
 *  arrival has finished playing (`arcs.ts`'s `arrivalPresentationAt`), it does not persist. */
export const INHABITED_COLOR = '#e6d7b8'
export const CITY_COLOR = '#7fd8ff'
export const SCENE_LOCATION_COLOR = '#fdf6e8'
