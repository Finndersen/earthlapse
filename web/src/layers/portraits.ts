/**
 * Ancestor portrait sampling (ADR-015, VISUAL_SPEC §10): which two plates to show at `t`, and
 * how far the morph between them has run. Pure; closes over already-parsed `TreeData` only.
 *
 * The plate shown at `t` belongs to the youngest plate-bearing node that has already diverged
 * by `t`, so a lineage node without a plate shows the nearest older plate. The morph band is
 * centred on each plate's divergence — the exact moment the ancestor readout's label switches
 * to it — so the image reads as half-way between the two plates right when the label does,
 * rather than lagging behind it. The band reaches `MORPH_BAND_FRACTION / 2` of the log1p gap
 * up into the older plate's span (bounded by the older plate's own divergence) and the same
 * fraction of the log1p gap down toward the next younger plate's divergence (or the present).
 * log1p is the symlog timeline's warp, as in `scene.ts`'s dissolve, so a band has a
 * proportional on-screen width at any zoom.
 */

import type { PortraitMorphData, TreeData } from '@/data/curated'
import type { MixKeying } from '@/lib/presentedMix'
import type { GeoTime, PortraitMix, PortraitMorph, PortraitPlate } from '@/types/layer'

/** The full morph band as a fraction of the log1p gap either side of a plate's divergence —
 *  half of it above, half below (see module doc). A quarter keeps each plate clear for three
 *  quarters of its span to each neighbour and gives the morph room to read on the timeline; the
 *  presentation limiter guarantees its wall-clock floor however fast `t` moves. */
export const MORPH_BAND_FRACTION = 0.25

/** A full morph never displays in less than this, however abruptly `t` jumps. Shorter than the
 *  scene's 1.6 s: the plate is small and peripheral, and should settle before the scene does. */
export const MIN_PORTRAIT_TRANSITION_SECONDS = 1.2

const FLOW_ZERO_BYTE = 128
const FLOW_BYTE_SPAN = 127

export interface PortraitIndex {
  /** Ascending by `tDivergence`, youngest first. */
  readonly plates: readonly PortraitPlate[]
}

/** Joins a tree's published plates to their nodes and morphs, once. Null when it has none. */
export function indexPortraits(data: TreeData): PortraitIndex | null {
  const set = data.portraits
  if (set === undefined) return null
  const divergence = new Map(data.nodes.map((n) => [n.id, n.tDivergence]))
  const morphByYounger = new Map(set.morphs.map((m) => [m.younger, m]))
  const plates = set.plates.map((p): PortraitPlate => {
    const tDivergence = divergence.get(p.nodeId)
    if (tDivergence === undefined) throw new Error(`portrait for unknown node ${p.nodeId}`)
    const plate: PortraitPlate = {
      nodeId: p.nodeId,
      tDivergence,
      image: p.image,
      plate: p.plate,
      width: p.width,
      height: p.height,
    }
    const morph = morphByYounger.get(p.nodeId)
    if (morph !== undefined) plate.morphFromOlder = toMorph(morph)
    return plate
  })
  plates.sort((a, b) => a.tDivergence - b.tDivergence)
  for (let i = 1; i < plates.length; i++) {
    const prev = plates[i - 1]!
    const curr = plates[i]!
    if (prev.tDivergence === curr.tDivergence) {
      throw new Error(
        `portraits ${prev.nodeId} and ${curr.nodeId} share tDivergence ${curr.tDivergence}; portraitAt assumes strictly increasing divergences`,
      )
    }
  }
  return { plates }
}

function toMorph(m: PortraitMorphData): PortraitMorph {
  return {
    older: m.older,
    forward: m.forward,
    backward: m.backward,
    forwardRange: m.forwardRange,
    backwardRange: m.backwardRange,
    size: m.size,
  }
}

function smoothstep01(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * (3 - 2 * x)
}

function alone(plate: PortraitPlate): PortraitMix {
  return { from: plate, to: plate, mix: 0 }
}

/** Half the morph band above a plate's divergence, toward `older`'s — the room available before
 *  the band would run past the older plate's own transition. `Infinity` for the oldest plate,
 *  which has no older neighbour to bound against and is simply shown alone (see `portraitAt`). */
function halfBandAbove(current: PortraitPlate, older: PortraitPlate | undefined): number {
  if (older === undefined) return Infinity
  return (MORPH_BAND_FRACTION / 2) * (Math.log1p(older.tDivergence) - Math.log1p(current.tDivergence))
}

/** Half the morph band below a plate's divergence, toward `youngerBoundary` — the next younger
 *  plate's divergence, or the present (0). */
function halfBandBelow(current: PortraitPlate, youngerBoundary: GeoTime): number {
  return (MORPH_BAND_FRACTION / 2) * (Math.log1p(current.tDivergence) - Math.log1p(youngerBoundary))
}

/** How far `delta` (a log1p distance from the divergence, always >= 0) has run into a half-band
 *  of width `half`: a smoothstep, saturating immediately once `half` leaves no room to blend. */
function halfBandProgress(delta: number, half: number): number {
  return half > 0 ? smoothstep01(delta / half) : delta > 0 ? 1 : 0
}

/** The portrait target at `t`: null before the oldest plate's divergence. */
export function portraitAt(index: PortraitIndex, t: GeoTime): PortraitMix | null {
  const { plates } = index
  const oldest = plates[plates.length - 1]
  if (oldest === undefined || t > oldest.tDivergence) return null

  // The band-shifted analogue of the old `p.tDivergence >= t`: a plate claims `t` through its
  // own half-band above, into what would otherwise be the older plate's span. The oldest plate's
  // bound is `Infinity`, so this always matches by the time the scan reaches it.
  const logT = Math.log1p(t)
  const k = plates.findIndex((p, i) => logT <= Math.log1p(p.tDivergence) + halfBandAbove(p, plates[i + 1]))
  const current = plates[k]!
  const older = plates[k + 1]
  if (older === undefined) return alone(current)

  const logDiv = Math.log1p(current.tDivergence)
  const youngerBoundary = plates[k - 1]?.tDivergence ?? 0
  const mix =
    logT >= logDiv
      ? 0.5 - 0.5 * halfBandProgress(logT - logDiv, halfBandAbove(current, older))
      : 0.5 + 0.5 * halfBandProgress(logDiv - logT, halfBandBelow(current, youngerBoundary))
  return mix >= 1 ? alone(current) : { from: older, to: current, mix }
}

/** Presentation keys plates by node, and measures distance in the same log1p space as the band. */
export const PORTRAIT_MIX_KEYING: MixKeying<PortraitPlate> = {
  same: (a, b) => a.nodeId === b.nodeId,
  distance: (a, b) => Math.abs(Math.log1p(a.tDivergence) - Math.log1p(b.tDivergence)),
}

/** What the renderer draws: `alpha` 0 is the older plate alone, 1 the younger alone. */
export interface PortraitDrawState {
  older: PortraitPlate
  younger: PortraitPlate
  alpha: number
  /** Present only when the two plates are adjacent and their morph was computed; a direct jump
   *  across several plates, or an uncomputed pair, crossfades without warping. */
  morph: PortraitMorph | null
}

/** Normalises a presented mix, which may run in either direction in time, into draw order. */
export function portraitDrawState({ from, to, mix }: PortraitMix): PortraitDrawState {
  const fromIsOlder = from.tDivergence >= to.tDivergence
  const older = fromIsOlder ? from : to
  const younger = fromIsOlder ? to : from
  const candidate = younger.morphFromOlder
  const morph = candidate !== undefined && older.nodeId !== younger.nodeId && candidate.older === older.nodeId ? candidate : null
  return { older, younger, alpha: fromIsOlder ? mix : 1 - mix, morph }
}

/** The eased blend and warp amount: smoothstep, exact at both ends. */
export function portraitEase(alpha: number): number {
  return smoothstep01(alpha)
}

/** A flow texture byte back to a displacement in plate UV (pipeline/flowfield.py's encoding). */
export function decodeFlowByte(byte: number, range: number): number {
  return ((byte - FLOW_ZERO_BYTE) / FLOW_BYTE_SPAN) * range
}
