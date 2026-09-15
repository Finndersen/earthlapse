/**
 * The time store. Holds ONLY cursor/view state: `t`, the selected era section, the timeline
 * scale kind, playback, and which overlays are expanded. No derived data: nothing here is a
 * projection of `t` (that is what `WorldState`/`Layer.sample` are for; see DESIGN §4, §10). The
 * timeline's visible window is not stored either. It is the selected section's window
 * (`sectionById(sectionId).window`, ADR-024), a lookup rather than free zoom state.
 *
 * Invariant: the selected section always contains `t`. `setT` re-derives the section on every
 * move (`sectionFollowingT`). Playback running past a section's end moves into the next one, and
 * a jump elsewhere climbs to a section that holds it. `selectSection` moves `t` to the section's
 * start when it was outside.
 *
 * This is the one piece of global state in the app (DESIGN §12: "zustand holding the single
 * `t`"). Packages W7-W10 stay prop-driven and must not import this store directly; W12 wires
 * their props to it.
 */

import { create } from 'zustand'

import { ROOT_SECTION_ID, sectionEntryT, sectionFollowingT, type SectionId } from '@/timeline/sections'
import { EARTH_FORMATION, type GeoTime, type Playback, type PlaybackMode, type ScaleKind } from '@/types/layer'

const TIME_DOMAIN: [GeoTime, GeoTime] = [0, EARTH_FORMATION]

function clampT(t: GeoTime): GeoTime {
  if (Number.isNaN(t)) {
    throw new Error(`setT: t must be a number, got NaN`)
  }
  return Math.min(TIME_DOMAIN[1], Math.max(TIME_DOMAIN[0], t))
}

export interface TimeState {
  /** Years before present. Always within [0, EARTH_FORMATION]. */
  t: GeoTime
  /** The era section the timeline shows (ADR-024). Always contains `t`. */
  sectionId: SectionId
  scaleKind: ScaleKind
  playback: Playback
  /** Whether the corner globe overlay has been expanded to fill (DESIGN §7). */
  globeExpanded: boolean
  /** Which HUD layer's sparkline is expanded to a full-width chart, if any (DESIGN §8). */
  expandedChartLayerId: string | null
  /** The event feed card (or, later, timeline marker) currently open in `EventDetailPanel`
   *  (W-followup item 12), if any. `Experience.tsx` owns the accompanying "pause on open, resume
   *  on close if it was playing" behaviour — this store only remembers which event, like
   *  `expandedChartLayerId` remembers which chart. */
  detailEventId: string | null

  /** Moves `t` (clamped to the domain) and follows it with the section: see the invariant in
   *  this module's doc comment. */
  setT: (t: GeoTime) => void
  /** Shows `id`, moving `t` to its start if `t` was outside it. */
  selectSection: (id: SectionId) => void
  setScaleKind: (kind: ScaleKind) => void
  setPlaying: (playing: boolean) => void
  togglePlaying: () => void
  setSpeed: (speed: number) => void
  setPlaybackMode: (mode: PlaybackMode) => void
  setGlobeExpanded: (expanded: boolean) => void
  setExpandedChartLayerId: (id: string | null) => void
  setDetailEventId: (id: string | null) => void
}

export const useTimeStore = create<TimeState>((set) => ({
  t: 0,
  sectionId: ROOT_SECTION_ID,
  scaleKind: 'symlog',
  playback: { playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' },
  globeExpanded: false,
  expandedChartLayerId: null,
  detailEventId: null,

  setT: (t) =>
    set((s) => {
      const clamped = clampT(t)
      return { t: clamped, sectionId: sectionFollowingT(s.sectionId, clamped) }
    }),
  selectSection: (sectionId) => set((s) => ({ sectionId, t: sectionEntryT(sectionId, s.t) })),
  setScaleKind: (scaleKind) => set({ scaleKind }),
  setPlaying: (playing) => set((s) => ({ playback: { ...s.playback, playing } })),
  togglePlaying: () => set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } })),
  setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
  setPlaybackMode: (mode) => set((s) => ({ playback: { ...s.playback, mode } })),
  setGlobeExpanded: (globeExpanded) => set({ globeExpanded }),
  setExpandedChartLayerId: (expandedChartLayerId) => set({ expandedChartLayerId }),
  setDetailEventId: (detailEventId) => set({ detailEventId }),
}))
