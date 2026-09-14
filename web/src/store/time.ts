/**
 * The time store. Holds ONLY cursor/view state — `t`, the visible window, the timeline
 * scale, playback, and which overlays are expanded. No derived data: nothing here is a
 * projection of `t` (that is what `WorldState`/`Layer.sample` are for — see DESIGN §4, §10).
 *
 * This is the one piece of global state in the app (DESIGN §12: "zustand holding the single
 * `t`"). Packages W7-W10 stay prop-driven and must not import this store directly; W12 wires
 * their props to it.
 */

import { create } from 'zustand'

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
  /** [newest, oldest] years BP — the visible span of the timeline, a subset of the full
   *  domain used for zoom. Independent of `t`; scrubbing does not move the window. */
  window: [GeoTime, GeoTime]
  scaleKind: ScaleKind
  playback: Playback
  /** Whether the corner globe overlay has been expanded to fill (DESIGN §7). */
  globeExpanded: boolean
  /** Which HUD layer's sparkline is expanded to a full-width chart, if any (DESIGN §8). */
  expandedChartLayerId: string | null

  setT: (t: GeoTime) => void
  setWindow: (window: [GeoTime, GeoTime]) => void
  setScaleKind: (kind: ScaleKind) => void
  setPlaying: (playing: boolean) => void
  togglePlaying: () => void
  setSpeed: (speed: number) => void
  setPlaybackMode: (mode: PlaybackMode) => void
  setGlobeExpanded: (expanded: boolean) => void
  setExpandedChartLayerId: (id: string | null) => void
}

export const useTimeStore = create<TimeState>((set) => ({
  t: 0,
  window: TIME_DOMAIN,
  scaleKind: 'symlog',
  playback: { playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' },
  globeExpanded: false,
  expandedChartLayerId: null,

  setT: (t) => set({ t: clampT(t) }),
  setWindow: (window) => set({ window }),
  setScaleKind: (scaleKind) => set({ scaleKind }),
  setPlaying: (playing) => set((s) => ({ playback: { ...s.playback, playing } })),
  togglePlaying: () => set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } })),
  setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
  setPlaybackMode: (mode) => set((s) => ({ playback: { ...s.playback, mode } })),
  setGlobeExpanded: (globeExpanded) => set({ globeExpanded }),
  setExpandedChartLayerId: (expandedChartLayerId) => set({ expandedChartLayerId }),
}))
