/**
 * The time store. Holds ONLY cursor/view state — `t`, the timeline scale kind, playback, and
 * which overlays are expanded. No derived data: nothing here is a projection of `t` (that is
 * what `WorldState`/`Layer.sample` are for — see DESIGN §4, §10). There is no visible-window
 * field: the timeline has no zoom/pan (removed; DESIGN §3's v1 note), so the window it draws is
 * always the fixed full domain, a constant rather than state.
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
  scaleKind: ScaleKind
  playback: Playback
  /** Whether the corner globe overlay has been expanded to fill (DESIGN §7). */
  globeExpanded: boolean
  /** Which HUD layer's sparkline is expanded to a full-width chart, if any (DESIGN §8). */
  expandedChartLayerId: string | null

  setT: (t: GeoTime) => void
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
  scaleKind: 'symlog',
  playback: { playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' },
  globeExpanded: false,
  expandedChartLayerId: null,

  setT: (t) => set({ t: clampT(t) }),
  setScaleKind: (scaleKind) => set({ scaleKind }),
  setPlaying: (playing) => set((s) => ({ playback: { ...s.playback, playing } })),
  togglePlaying: () => set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } })),
  setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
  setPlaybackMode: (mode) => set((s) => ({ playback: { ...s.playback, mode } })),
  setGlobeExpanded: (globeExpanded) => set({ globeExpanded }),
  setExpandedChartLayerId: (expandedChartLayerId) => set({ expandedChartLayerId }),
}))
