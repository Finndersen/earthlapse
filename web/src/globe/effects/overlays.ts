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

import { clamp01, smoothstep, warpedEdgeProgress } from './math'

/** Ease width applied outward from a window's own [tMin, tMax] — the cited interval itself
 *  stays at full intensity throughout; only the fade just outside it is artistic. "The easing
 *  widths are artistic and do not claim onset rates" (docs/GLOBE.md §4.3).
 *
 *  The ease is sized in `easeWidthWarp` — a constant width on the timeline's symlog warp
 *  (`math.ts`'s `symlogWarp`/`warpedEdgeProgress`), not a fixed number of years: a fixed-year
 *  ease reads fine near the present but goes sub-pixel deep in time (at ~650 Ma, `symlogWarp`
 *  compresses a 3 Myr span to well under one screen pixel), which is exactly what made the
 *  Snowball ice shell above/below appear and disappear abruptly during playback instead of
 *  fading (regression fixed for docs/GLOBE.md §4.3's "gradual transition"). */
function windowEnvelope(window: GlobeEffectWindow, t: GeoTime, easeWidthWarp: number): number {
  if (t >= window.tMin && t <= window.tMax) return 1
  const edge = t > window.tMax ? window.tMax : window.tMin
  return 1 - warpedEdgeProgress(t, edge, easeWidthWarp)
}

/** Max envelope across every window of every event carrying an effect of `kind` — a union,
 *  since e.g. Snowball Earth's Sturtian and Marinoan windows (and, separately, the
 *  Paleoproterozoic glaciation regime) all render with this same `ice-shell` kind and should
 *  each independently light it up. */
function unionEnvelope(events: readonly TimelineEvent[], kind: GlobeEffectKind, t: GeoTime, easeWidthWarp: number): number {
  let intensity = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== kind) continue
    for (const w of effect.windows) {
      intensity = Math.max(intensity, windowEnvelope(w, t, easeWidthWarp))
    }
  }
  return intensity
}

/** Warp-space ease width (see `windowEnvelope`'s doc comment) for the ice shell's window edges
 *  — brief next to every `ice-shell` window (Sturtian's 56 Myr, even Marinoan's cited ~4 Myr),
 *  matching "the shell... eases in and out at each window edge" (§4.3), but readable at any
 *  era: at the Sturtian's ~717 Ma older edge this reads as ~11 Myr of real time, comparable to
 *  the ~22 Myr Sturtian-Marinoan interglacial gap, so scrubbing across it reads as a fade
 *  (and, where the Marinoan's own edges' fades reach into that gap, a gentle thaw rather than a
 *  hard clear sky) rather than a cut. */
export const ICE_SHELL_EASE_WARP = 0.015

/** Ice-shell intensity (0..1) at `t`: 1 throughout any active window (Sturtian, Marinoan, or
 *  the Paleoproterozoic glaciation regime — whichever event(s) supplied it), eased at the
 *  edges. Callers pass both `events-core` (Snowball Earth) and `globe-regimes` (the
 *  Paleoproterozoic regime) — either can carry an `ice-shell` effect. */
export function iceShellIntensity(events: readonly TimelineEvent[], t: GeoTime): number {
  return unionEnvelope(events, 'ice-shell', t, ICE_SHELL_EASE_WARP)
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
 *  timescale. Strictly zero at and before the impact instant (`yearsAfter <= 0`): the veil
 *  does not anticipate it, and a scene sitting exactly on the impact moment (the pre-impact
 *  `kpg-arrival` scene) must show the clear, pre-impact globe, not a post-impact one. */
export function impactWinterVeil(events: readonly TimelineEvent[], t: GeoTime): number {
  let veil = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'impact-winter') continue
    for (const w of effect.windows) {
      const yearsAfter = (w.tMin + w.tMax) / 2 - t
      if (yearsAfter <= 0) continue
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
 *  the flash is anchor-local (`impactWinterAnchor`) while the veil is global. Strictly zero at
 *  and before the impact instant, for the same reason as `impactWinterVeil`. */
export function impactWinterFlash(events: readonly TimelineEvent[], t: GeoTime): number {
  let flash = 0
  for (const event of events) {
    const effect = event.effect
    if (effect === undefined || effect.kind !== 'impact-winter') continue
    for (const w of effect.windows) {
      const yearsAfter = (w.tMin + w.tMax) / 2 - t
      if (yearsAfter <= 0) continue
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
