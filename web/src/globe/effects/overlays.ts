/**
 * Envelope curves for the effects that overlay whatever the globe is otherwise showing,
 * rather than competing for it like the pre-1 Ga regimes (`regimes.ts`): the Snowball/
 * Paleoproterozoic ice shell (docs/GLOBE.md §4.3, part of G6), the Chicxulub impact winter and
 * its flash, and the Moon-forming giant impact's flash (§5.3, ADR-013's `effect` field).
 *
 * Every function takes the full event list it reads (`events-core` and/or `globe-regimes`,
 * whichever owns the kind) and `t`, and is pure in both — `Δ = t_event − t` throughout, per
 * §5.3. Each is independent of the others and of `regimes.ts`'s blend weights: the resolver
 * (`resolve.ts`) composes them.
 */

import type { GeoTime, GlobeEffectAnchor, GlobeEffectKind, GlobeEffectWindow, TimelineEvent } from '@/types/layer'

import { clamp01, smoothstep } from './math'

/** Ease width applied outward from a window's own [tMin, tMax] — the cited interval itself
 *  stays at full intensity throughout; only the fade just outside it is artistic. "The easing
 *  widths are artistic and do not claim onset rates" (docs/GLOBE.md §4.3). */
function windowEnvelope(window: GlobeEffectWindow, t: GeoTime, easeYears: number): number {
  if (t >= window.tMin && t <= window.tMax) return 1
  const distanceOutside = t > window.tMax ? t - window.tMax : window.tMin - t
  return 1 - smoothstep(0, easeYears, distanceOutside)
}

/** Max envelope across every window of every event carrying an effect of `kind` — a union,
 *  since e.g. Snowball Earth's Sturtian and Marinoan windows (and, separately, the
 *  Paleoproterozoic glaciation regime) all render with this same `ice-shell` kind and should
 *  each independently light it up. */
function unionEnvelope(events: readonly TimelineEvent[], kind: GlobeEffectKind, t: GeoTime, easeYears: number): number {
  let intensity = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== kind) continue
    for (const w of effect.windows) {
      intensity = Math.max(intensity, windowEnvelope(w, t, easeYears))
    }
  }
  return intensity
}

/** 3 Myr: brief next to every `ice-shell` window (Sturtian's 56 Myr, even Marinoan's cited
 *  ~4 Myr), matching "the shell... eases in and out at each window edge" (§4.3). */
export const ICE_SHELL_EASE_YEARS = 3e6

/** Ice-shell intensity (0..1) at `t`: 1 throughout any active window (Sturtian, Marinoan, or
 *  the Paleoproterozoic glaciation regime — whichever event(s) supplied it), eased at the
 *  edges. Callers pass both `events-core` (Snowball Earth) and `globe-regimes` (the
 *  Paleoproterozoic regime) — either can carry an `ice-shell` effect. */
export function iceShellIntensity(events: readonly TimelineEvent[], t: GeoTime): number {
  return unionEnvelope(events, 'ice-shell', t, ICE_SHELL_EASE_YEARS)
}

/** How long the K-Pg veil holds near-black before beginning to recover, and how long full
 *  recovery takes — both in years after the impact, per docs/GLOBE.md §5.3's reading of Tabor
 *  et al. 2020 and Senel et al. 2023 as "one global veil: near-black to ~2 yr, then recovery
 *  to ~15 yr". */
export const IMPACT_WINTER_DARK_YEARS = 2
export const IMPACT_WINTER_RECOVERY_YEARS = 15

/** The K-Pg impact winter's darkening veil (0 = clear, 1 = near-black) at `t`. `Δ` is
 *  measured from each window's midpoint — for `k-pg-impact`'s own `[66.032, 66.054]` Ma
 *  window that lands exactly on Renne et al. 2013's 66.043 Ma central estimate, not (as the
 *  window's ~22 kyr width might suggest) something comparable to the veil's own few-year
 *  timescale. Zero before the impact: the veil does not anticipate it. */
export function impactWinterVeil(events: readonly TimelineEvent[], t: GeoTime): number {
  let veil = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'impact-winter') continue
    for (const w of effect.windows) {
      const yearsAfter = (w.tMin + w.tMax) / 2 - t
      if (yearsAfter < 0) continue
      const v =
        yearsAfter <= IMPACT_WINTER_DARK_YEARS
          ? 1
          : 1 - smoothstep(IMPACT_WINTER_DARK_YEARS, IMPACT_WINTER_RECOVERY_YEARS, yearsAfter)
      veil = Math.max(veil, v)
    }
  }
  return veil
}

/** Decay constant for an impact's brief flash — "hours to days" per §5.3, both for
 *  `impact-winter`'s own flash and `giant-impact`'s. Artistic: neither effect's flash carries
 *  a claimed literature duration, only the days-to-months darkening that follows it. */
const IMPACT_FLASH_DECAY_YEARS = 0.01

/** The K-Pg flash's intensity (0..1) at `t`, decaying from the same event moment as
 *  `impactWinterVeil`'s veil. Kept separate from the veil (rather than folded into it) because
 *  the flash is anchor-local (`impactWinterAnchor`) while the veil is global. */
export function impactWinterFlash(events: readonly TimelineEvent[], t: GeoTime): number {
  let flash = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'impact-winter') continue
    for (const w of effect.windows) {
      const yearsAfter = (w.tMin + w.tMax) / 2 - t
      if (yearsAfter < 0) continue
      flash = Math.max(flash, Math.exp(-yearsAfter / IMPACT_FLASH_DECAY_YEARS))
    }
  }
  return flash
}

/**
 * The `impact-winter` event's anchor, present-day coordinates (docs/GLOBE.md §5.3), or `null`
 * when none carries one. `k-pg-impact` is the only one today.
 *
 * APPROXIMATION (flagged per the task brief, and worth tracking alongside G4/G7's plate-
 * rotation work): reconstructing this to the K-Pg-era plate position is out of scope here —
 * the anchor is placed at its present-day lat/lon regardless of which frame `t` is currently
 * showing, rather than at Chicxulub's actual 66 Ma position. The Yucatán has moved only a
 * little since the K-Pg (mid-latitude, not a fast-moving plate margin), so the visible error
 * is small next to the effect's own artistic license, but it is still wrong to a precision a
 * viewer zoomed on the anchor could notice.
 */
export function impactWinterAnchor(events: readonly TimelineEvent[]): GlobeEffectAnchor | null {
  for (const event of events) {
    const effect = event.effect
    if (effect !== undefined && effect.kind === 'impact-winter' && effect.anchor !== undefined) {
      return effect.anchor
    }
  }
  return null
}

/** A lat/lon anchor's position in the globe shader's own UV space, inverting the mapping
 *  documented on `GLOBE_FRAGMENT_SHADER` in `shaders.ts` (`u = 0.5 − lonRad/2π`,
 *  `v = 0.5 − latRad/π`): this is the same equirectangular unwrap the PaleoDEM textures are
 *  authored in, so a present-day anchor lands over the right stretch of coastline on the 0 Ma
 *  frame. `u` wraps at the antimeridian; `v` is clamped rather than wrapped (there's no "other
 *  side" of a pole to wrap to). */
export interface AnchorUv {
  u: number
  v: number
}

export function anchorUv(anchor: GlobeEffectAnchor): AnchorUv {
  const u = 0.5 - anchor.lon / 360
  const v = 0.5 - anchor.lat / 180
  return { u: ((u % 1) + 1) % 1, v: clamp01(v) }
}

/** Same envelope shape as `giantImpactFlash`'s doc comment describes: an artistic pulse, not
 *  a literature duration (§5.3: "artistic; no literature envelope is claimed" for
 *  `moon-forming-impact`). Placed at the *older* (larger-`t`) edge of the effect's window —
 *  the end of its contested 4.35–4.52 Ga range nearer the more-cited ~4.51 Ga estimate —
 *  decaying towards the present as the `regime-magma-ocean` steady state (the same window,
 *  `regimes.ts`) takes over. */
const GIANT_IMPACT_FLASH_DECAY_YEARS = 8e6

export function giantImpactFlash(events: readonly TimelineEvent[], t: GeoTime): number {
  let flash = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'giant-impact') continue
    for (const w of effect.windows) {
      if (t > w.tMax || t < w.tMin) continue
      const sinceImpact = w.tMax - t
      flash = Math.max(flash, Math.exp(-sinceImpact / GIANT_IMPACT_FLASH_DECAY_YEARS))
    }
  }
  return flash
}
