'use client'

/**
 * The globe view (DESIGN §7). A three.js sphere, independent of the scene view, driven only
 * by `t`. See `index.ts` for the props contract.
 */

import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import * as THREE from 'three'

import type { RasterData } from '@/data/curated'
import { resolveAssetUrl } from '@/lib/assetUrl'
import { usePresentedMix, type Mix } from '@/lib/presentedMix'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { probeWebgl } from '@/lib/webgl'
import type { FeatureData, GeoTime, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'
import type { SceneLocation } from '@/types/manifest'

import { arrivalTimingFor, arrivalWindow } from './arcs'
import { citiesHaveDataAt } from './cities'
import { densityChannelMask } from './density'
import {
  EMPIRE_FRAME_KEYING,
  empireHighlightIn,
  empiresHaveDataAt,
  empireSnapshotsAt,
  type EmpireFrame,
  type EmpireIndex,
} from './empires'
import { EMPIRE_LABEL_CAP_DESKTOP, EMPIRE_LABEL_CAP_PHONE, selectEmpireTier } from './empireStyle'
import {
  createEmpireTextureCache,
  empireTextureKey,
  setEmpireMaxAnisotropy,
  useEmpireGeometry,
  type EmpireTextureCache,
} from './empireTexture'
import { HumanCivilisation } from './HumanCivilisation'
import {
  GLOBE_OVERLAYS,
  GLOBE_OVERLAY_KINDS,
  overlayBlendAt,
  overlayKindUniform,
  overlayStrengthAt,
  type GlobeOverlayKind,
  type OverlaySampling,
} from './overlay'
import { OverlaySelect } from './OverlaySelect'
import { sceneMarkerCoordinates } from './sceneLocation'
import {
  basemapStrengthAt,
  globeBlendAt,
  globeMultiBlendAt,
  globeMultiCaptionFor,
  globeMultiPreloadUrls,
  globePreloadUrls,
  globeUniforms,
  regimeEventsWithRasterFallback,
  travelDirection,
  type GlobeBlend,
  type GlobeRasterLayers,
  type PreloadWindow,
  type TravelDirection,
} from './blend'
import {
  budgetedDpr,
  centerOffset,
  clampedDollyDistance,
  clampPanTarget,
  fitDistance,
  isSubFrameOf,
  mapHasPanRoom,
  sphereFitDistance,
  sphereRotateSpeedForDistance,
  sphereSilhouetteFraction,
  sphereViewFocus,
  subFrameFovY,
  unfoldCameraPose,
  zoomRatio,
  type UnfoldViewEnds,
} from './camera'
import { selectBasemapTier, supportsBasemapT1, useIsPhoneViewport } from './deviceTier'
import { useGlobeEffects, type GlobeEffectUniforms } from './effects'
import styles from './Globe.module.css'
import { buildGlobeGeometry } from './globeGeometry'
import { GlobeStaticOrb } from './GlobeStaticOrb'
import {
  basemapTextureCache,
  densityTextureCache,
  initAndCloseHumanEraTexture,
  setHumanEraMaxAnisotropy,
} from './humanEraTextureCache'
import { ICE_SHEET_DOME_COUNT, type IceAgeLayers, type IceAgeState, useIceAge, writeIceSheetRadii } from './ice'
import { Legend, type LegendRow } from './Legend'
import { isOrbClick } from './orbGesture'
import { isPoleVisible, poleDirection, type PoleId } from './poles'
import { EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, lonLatToMap, mapToLonLat, unrolledHalfHeight, unrolledHalfWidth } from './projection'
import {
  ATMOSPHERE_SCALE,
  GLOBE_FRAGMENT_SHADER,
  GLOBE_VERTEX_SHADER,
  RIM_FRAGMENT_SHADER,
  RIM_VERTEX_SHADER,
} from './shaders'
import { PLACEHOLDER_TEXTURE, setMaxAnisotropy } from './textureCache'
import { useGlobeAutoRotationY } from './useGlobeAutoRotation'
import { useGlobeTexturePair, type GlobeTextureCache } from './useGlobeTexturePair'
import { useUnfold } from './unfoldAnimation'

const RIM_COLOR = new THREE.Color('#8fc7ff')
/** The minimised and expanded canvas's vertical field of view, in degrees. */
const CAMERA_FOV_DEG = 40
/** Far enough back (with `CAMERA_FOV_DEG`) that the sphere and its atmosphere shell sit whole
 *  inside the canvas with a margin — the orb reads as a floating object, never a disc
 *  clipped square. The planet's silhouette lands at ≈89% of the canvas half-size
 *  (`ORB_SILHOUETTE_INSET`, below), which Globe.module.css's static fallback and expand ring
 *  are sized against.
 *
 *  The orb's box is already the same size as the ancestor portrait opposite it
 *  (`ShellLayout.module.css`'s `--orb-size`, which `hud.module.css`'s `.portrait` reads on a
 *  phone), but the portrait fills its own box while the sphere sat well inside this one, so the
 *  two read as different sizes. Closing the camera fills more of the same box, which is the only
 *  lever available here: growing the box instead would run the orb into the centred time title,
 *  which `--orb-size`'s own phone rule is already sized right up against. */
const CAMERA_DISTANCE = 3.24
/** `OrbitControls`'s own rotate-drag speed at each mode's idle (unzoomed) distance — tuned by
 *  feel and confirmed to track a one-finger drag 1:1 there. Away from that distance,
 *  `sphereRotateSpeedForDistance` (`camera.ts`) scales it so the same drag keeps tracking the
 *  surface at any zoom level, rather than the fixed value three.js otherwise applies regardless
 *  of distance (see that function's own doc comment for the derivation). */
const DEFAULT_ROTATE_SPEED = 0.6
/** The minimised orb's own device-pixel-ratio range — small canvas, so retina sharpness is cheap. */
const MINIMISED_DPR: [number, number] = [1, 2]
/**
 * The pixel budget `budgetedDpr` (`camera.ts`) sizes the *expanded* canvas's device pixel ratio
 * against. The expanded canvas covers the whole backdrop, so its drawing-buffer pixel count (not
 * input handling) is what makes dragging feel sluggish on a large/high-DPI display — cost scales
 * roughly linearly with pixel count past ~5M px.
 *
 * A flat DPR pin bounds nothing: soft on a small buffer, still unbounded on a large one (a 5K
 * display's buffer at `dpr: 1` is worse than an ordinary laptop's at full retina). Budgeting the
 * buffer itself holds at any display size. `5_200_000` keeps 1440x900 at `dpr: 2` (~5.18M px, the
 * common case) at full retina sharpness, while a 5K-class request tapers down to fit the same
 * budget instead of paying for triple the pixels.
 */
const EXPANDED_DPR_BUDGET_PIXELS = 5_200_000
/** `GlobeSphere`'s own `sphereGeometry` radius — named so the pole markers below (`poles.ts`,
 *  `PoleAxisMarkers`) agree with the sphere on exactly where its surface sits. */
const GLOBE_RADIUS = 1
/** The margin between the minimised orb's square box and the sphere's drawn silhouette, as a
 *  percentage of the box's side — exposed to Globe.module.css as `--orb-silhouette-inset`. */
const ORB_SILHOUETTE_INSET = `${((1 - sphereSilhouetteFraction(GLOBE_RADIUS, CAMERA_DISTANCE, CAMERA_FOV_DEG)) / 2) * 100}%`
const ORB_STYLE = { '--orb-silhouette-inset': ORB_SILHOUETTE_INSET } as CSSProperties
/** Frames are ~5-10 Myr apart across both raster sources; a few ahead covers fast playback
 *  through one network round trip, one behind covers a small scrub reversal. Must stay well
 *  inside textureCache's capacity. */
const PRELOAD_WINDOW: PreloadWindow = { ahead: 4, behind: 1 }
/** Basemap textures (T0/T1, several MB each) are only fetched/bound once `t` is within reach of
 *  the crossfade band (`BASEMAP_CROSSFADE_BAND`'s own far edge, 400 ka) — a session that never
 *  scrubs near the present should never fetch a texture it will never show. The basemap is a
 *  single static texture per tier, not a dated sequence, so "just in time" fetching (starting
 *  the moment `t` enters this margin, from either direction) is enough — there's no multi-frame
 *  preload sequence to keep ahead of, only a comfortable lead time before the band itself. */
const BASEMAP_FETCH_MARGIN_YEARS = 600_000

/** `uOverlayChannel`'s value while no overlay is selected — meaningless there (`uOverlayStrength`
 *  is 0), but a stable array identity beats allocating a fresh one on every render. */
const DEFAULT_OVERLAY_CHANNEL: readonly [number, number, number] = [1, 0, 0]
/** How long before `t` enters the empires layer's domain its geometry file is fetched, in years —
 *  far enough ahead that playback toward the present finds it loaded, near enough that a session
 *  that never reaches recorded history never downloads it. */
const EMPIRE_FETCH_MARGIN_YEARS = 5_000
/** The presented crossfade between two active empire sets — short, since a snapshot change is a
 *  step in the data, not a motion. */
const EMPIRE_CROSSFADE_SECONDS = 0.3
/** How long the hovered empire must hold before the territory texture repaints for it, so a
 *  sweep across several territories, or across the gap between two, paints only where it stops. */
const EMPIRE_HOVER_SETTLE_MS = 120
/** The frame shown when no empires layer is published. */
const NO_EMPIRE_FRAME: EmpireFrame = { key: '', order: -1, snapshots: [] }
/** Stands in for the empire cache until the geometry has loaded; never asked to load, since the
 *  empire blend is `null` until then. */
const NO_EMPIRE_CACHE: GlobeTextureCache = {
  loadTexture: () => Promise.reject(new Error('empire geometry not loaded')),
  trimTextures: () => {},
}

// ------------------------------------------------------------------------------ map mode

/** Equal Earth's own bounding box (`projection.ts`), scaled to this file's `GLOBE_RADIUS` —
 *  every map-mode camera calculation (`GlobeCameraControls`) is sized against these. */
const MAP_HALF_WIDTH = EQUAL_EARTH_HALF_WIDTH * GLOBE_RADIUS
const MAP_HALF_HEIGHT = EQUAL_EARTH_HALF_HEIGHT * GLOBE_RADIUS
/** Extra headroom around the map's own bounding box when framing it, so its curved edges never
 *  touch the viewport's own edge. The panel is only as tall as the shell's title-to-timeline gap
 *  (`Globe.module.css`'s `--chrome-gap-height`), and the map's box is aspect-locked to ~2.05:1
 *  (`Globe.module.css`'s `data-map-mode` rule), so that gap-limited height also caps the map's
 *  width — every percentage point of margin costs roughly 2x itself in final width. Tighter than
 *  the sphere's own margin (`SPHERE_FIT_MARGIN`) because the map has further to make up against
 *  the same gap-limited height, while still leaving a visible gap at the panel's own edge. */
const MAP_FIT_MARGIN = 0.03
/** How far past the "whole map fits" distance a viewer can zoom in, as a fraction of it. */
const MAP_MIN_ZOOM_FRACTION = 0.12
/** Extra headroom around the *expanded* sphere's own silhouette (`camera.ts`'s
 *  `sphereFitDistance`) — same value and meaning as `MAP_FIT_MARGIN` (tightened alongside it for
 *  the same "fill the real, tight gap" reason), kept as its own named constant since the two
 *  frame different shapes and could legitimately diverge. Deliberately *not* used for the
 *  minimised orb, whose own `CAMERA_DISTANCE` is a separate, looser framing (see that constant's
 *  own doc comment for why it stays that way). */
const SPHERE_FIT_MARGIN = 0.05
/** A deliberate nudge to the expanded sphere's default size, kept as its own named constant
 *  rather than a side effect of a chrome-height change. Applied by *dividing* the fitted idle
 *  distance (`GlobeCameraControls`), which moves the camera closer without touching
 *  `SPHERE_FIT_MARGIN`'s own, separate meaning (breathing room at the box edge) — the two would
 *  otherwise be easy to conflate into one "how big is the sphere" knob when they answer different
 *  questions. `1.05` measures 546px -> 573px drawn diameter at 1440x900 (`globe-expanded-sphere`
 *  QA shot). */
const SPHERE_DEFAULT_SCALE = 1.05
/** One press of the zoom-in/zoom-out buttons (`ZoomControls`, docs/GLOBE.md's ADR-033 map mode)
 *  — the same ~20% step a scroll-wheel tick reads as roughly, discrete enough to feel like a
 *  deliberate move rather than a barely-perceptible nudge. `zoomIn` uses this factor directly
 *  (distance shrinks -> object grows); `zoomOut` uses its reciprocal. */
const ZOOM_STEP_FACTOR = 0.8
/** Float-roundoff slack for "is this button at its range limit" checks (`GlobeCameraControls`'s
 *  `reportZoomBounds`) — without it, a distance that lands a hair inside a bound after repeated
 *  multiplication could read as still-zoomable when a further press would immediately clamp to
 *  the same value again. */
const ZOOM_BOUNDS_EPSILON = 1e-4
/** Floor on a carried height above the surface, so a ratio carried from one mode's deepest zoom
 *  can never put the camera on or through the other mode's surface. */
const MIN_SURFACE_HEIGHT = 0.01 * GLOBE_RADIUS

/**
 * What carries across a sphere <-> map switch: the geographic point at the centre of the view,
 * and how far each mode is zoomed as a ratio of its own default framing (`camera.ts`'s
 * `zoomRatio`) — so zooming in on India and switching to the map opens the map zoomed in on India
 * by the same amount, and switching back returns the sphere to it. `departed` names the end the
 * current morph left from, whose pose is kept exactly as measured.
 */
interface SphereMapView {
  focus: GlobeEffectAnchor
  departed: 'sphere' | 'map'
  departedHeight: number
  departedMapTarget: readonly [number, number]
  sphereZoom: number
  mapZoom: number
}

const DEFAULT_SPHERE_MAP_VIEW: SphereMapView = {
  focus: { lon: 0, lat: 0 },
  departed: 'sphere',
  departedHeight: 1,
  departedMapTarget: [0, 0],
  sphereZoom: 1,
  mapZoom: 1,
}

/** Scratch objects `GlobeSphere`'s own custom `mesh.raycast` (below) reuses across every click
 *  rather than allocating fresh ones, the same "one-shot event, not a per-frame cost, but no
 *  reason to churn" reasoning `GlobeTooltip.tsx`'s own `scratchWorld`/`scratchLocal` follow. The
 *  box is a plain module-level constant (never mutated) since its extents — the map's own
 *  Equal-Earth half-width/half-height at `radius = 1`, thickened slightly along `z` so a grazing
 *  ray still registers — never change; only the ray/point scratch objects are reused as mutable
 *  working storage. */
const RAYCAST_MAP_LOCAL_HALF_DEPTH = 0.05
const RAYCAST_MAP_LOCAL_BOX = new THREE.Box3(
  new THREE.Vector3(-EQUAL_EARTH_HALF_WIDTH, -EQUAL_EARTH_HALF_HEIGHT, 1 - RAYCAST_MAP_LOCAL_HALF_DEPTH),
  new THREE.Vector3(EQUAL_EARTH_HALF_WIDTH, EQUAL_EARTH_HALF_HEIGHT, 1 + RAYCAST_MAP_LOCAL_HALF_DEPTH),
)
const RAYCAST_UNIT_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1)
const raycastInverseMatrix = new THREE.Matrix4()
const raycastLocalRay = new THREE.Ray()
const raycastLocalHit = new THREE.Vector3()
const raycastWorldHit = new THREE.Vector3()

/** A no-op, stable-identity handler attached to the mesh purely to make r3f raycast it at all: r3f
 *  only adds an object to `internal.interaction` — the candidate list `onPointerMissed` tests
 *  against — "when it has handlers" (`@react-three/fiber`'s `events.js`: `if (instance.eventCount
 *  && object.raycast !== null)`), so a mesh with a working custom `raycast` but *no* JSX
 *  pointer-event prop is never even offered a chance to report a hit. `onPointerOver` costs
 *  nothing extra to pick (any handler registers the object equally). A module-level stable
 *  reference, not an inline arrow function, so the prop doesn't appear to "change" every render. */
const NOOP_POINTER_HANDLER = (): void => {}

/** A measured `.orbFitFrameSphere`/`.orbFitFrameMap` rectangle's size (`Globe.module.css`'s own
 *  doc comment) — width/height only; `GlobeCameraControls` never needs the raw top/left, just the
 *  aspect and the height ratio `subFrameFovY` (`camera.ts`) wants. */
interface FitFrameSize {
  width: number
  height: number
}

/** `Globe.tsx`'s own DOM-layer measurement of the two invisible fit-target rectangles plus the
 *  pixel shift (`centerOffset`, `camera.ts`) needed to re-centre the rendered sphere/map
 *  on them — see `GlobeCameraControls`'s doc comment for how all three are used. `null` until the
 *  first `ResizeObserver` pass (or when a frame isn't mounted, e.g. before `expanded`). */
interface FitMeasurements {
  sphereFit: FitFrameSize | null
  mapFit: FitFrameSize | null
  centerOffsetPx: { x: number; y: number }
}
const EMPTY_FIT_MEASUREMENTS: FitMeasurements = { sphereFit: null, mapFit: null, centerOffsetPx: { x: 0, y: 0 } }

/** Whether the zoom-in/zoom-out buttons (`ZoomControls`) can still do anything — mirrors
 *  `OrbitControls`'s own `minDistance`/`maxDistance` for the current mode, reported by
 *  `GlobeCameraControls` so the buttons can grey out at a real limit rather than clicking with no
 *  visible effect. */
interface ZoomBounds {
  canZoomIn: boolean
  canZoomOut: boolean
}

/** Imperative escape hatch for `ZoomControls` (plain DOM, outside the `<Canvas>`'s own
 *  react-three-fiber tree) to drive `GlobeCameraControls`'s camera — see that component's own doc
 *  comment for why this goes through the *same* clamped dolly path scroll/pinch already use
 *  rather than a second, parallel zoom state. */
interface GlobeCameraApi {
  zoomIn: () => void
  zoomOut: () => void
}

export interface GlobeProps {
  t: GeoTime
  /** Both globe raster sources (docs/GLOBE.md §4.1, G7): PaleoDEM (0-540 Ma) and, when
   *  published, Merdith et al. 2021's stylised continents (540-1000 Ma) — `null` when the
   *  latter is unusable, in which case `Globe` shows the "geography unknown" regime there
   *  instead of faking continents (`regimeEventsWithRasterFallback`). */
  rasterLayers: GlobeRasterLayers
  assetBase: string
  /** `globe-regimes`' full, unfiltered event list (docs/GLOBE.md §6, G8) — `[]` when that
   *  layer isn't published. Raw, not a `Layer<EventsValue>.sample(t)` slice: the regime
   *  crossfade (`effects/regimes.ts`) needs to see a regime's neighbour before `t` enters it. */
  regimeEvents: readonly TimelineEvent[]
  /** `events-core`'s full event list (`Manifest.events`) — read for the globe effects it
   *  carries: Snowball Earth's `ice-shell`, K-Pg's `impact-winter`, the Moon-forming impact's
   *  `giant-impact` (docs/GLOBE.md §5.3, §6). */
  effectEvents: readonly TimelineEvent[]
  /** The LR04 `ice_volume`/`sea_level` layers driving the Cenozoic ice sheets and lowstand
   *  (docs/GLOBE.md §5.1), or `null` when either isn't published — Antarctica still appears then,
   *  at its present extent. */
  iceAgeLayers: IceAgeLayers | null
  expanded: boolean
  onToggleExpand: () => void
  /** Reports the current caption text (docs/GLOBE.md §7) on every change, `''` for none. `Globe`
   *  never draws this itself, in either state — the caller places it: under the minimised orb
   *  (`ShellLayout`'s "Paleogeography" label slot) or, expanded, in `ShellLayout`'s `.stage`
   *  slot (the scene caption's own spot, already reserved clear of the timeline — `Globe`'s own
   *  fullscreen backdrop has no way to know where the timeline's playhead label actually sits,
   *  so it can't safely place text near it itself). Optional: a caller that doesn't care about
   *  the caption (e.g. a test harness) can omit it. */
  onCaptionChange?: (caption: string) => void
  /** The `cities` `FeatureSet` (ADR-035), or `null` when that layer isn't published. */
  cities: readonly FeatureData[] | null
  /** The historical-empires territories (ADR-059), indexed once by the caller
   *  (`buildEmpireIndex`), or `null` when that layer isn't published. Drawn under the "Human
   *  civilisation" toggle; the geometry file it names is fetched only as `t` nears its domain. */
  empires: EmpireIndex | null
  /** The current scene's `location` (ADR-034), or `null`/absent for a scene with no place. Only
   *  its `marker` is ever plotted — never `presentDay`. */
  sceneLocation: SceneLocation | null
  /** `Playback.baseRate` — the timeline's own rate model. The human layer derives its arrival
   *  timing from it statically (`arrivalTimingFor`), so an arc is legible rather than a flicker at
   *  default playback speed. */
  playbackBaseRate: number
  /** A new city label's fade window in years, given the city's own first-appearance `t` — passed
   *  straight through to `HumanCivilisation` (its own doc comment has the full rationale).
   *  Playback-derived like `playbackBaseRate` above, but per-city rather than a single scalar, so
   *  it arrives as a resolver instead. */
  cityLabelFadeWindowAt: (appearanceT: GeoTime) => GeoTime
  /** Event ids whose card is currently in the event feed, and the one the viewer is hovering —
   *  an arrival's arc and marker pulse in sympathy with its own card. */
  feedEventIds: ReadonlySet<string>
  hoveredFeedEventId: string | null
  /** Reports the expanded globe's own Globe/Map toggle (`ViewModeToggle`) real rendered height in
   *  CSS px on every change, `0` while it isn't mounted (collapsed, or no WebGL) — mirrors
   *  `onCaptionChange`'s own "cross the Globe/ShellLayout boundary via a callback" shape, for the
   *  same reason: `ShellLayout.tsx`'s `useChromeGap` needs this number (as `reserveBottomPx`) to
   *  size the expanded sphere/map into what's genuinely left over once the toggle's own band is
   *  set aside, but `ShellLayout` has no ref into this component's own internal DOM (`globe`
   *  arrives there as an already-rendered `ReactNode`).
   *  Optional: a caller that doesn't care (e.g. a test harness) can omit it. */
  onViewModeToggleHeightChange?: (heightPx: number) => void
  /** Opens an event's full detail — a click, or a second tap, on an arrival arc or inhabited
   *  marker while expanded. The caller looks the event up and shows it. */
  onActivateEvent?: (eventId: string) => void
  /** Opens an empire lineage's detail — a click, or a second tap, on its territory or label while
   *  expanded. */
  onActivateEmpire?: (lineage: string) => void
  /** The lineage whose detail is open, if any; its label draws highlighted. */
  selectedEmpire?: string | null
}

/** Whether `t` falls within the arrival layer's own domain — from the oldest arrival's dating
 *  bound (`arrivalWindow`'s own `tMax`) through to the present — rather than `arcs.ts`'s
 *  `hasVisibleArrivals`, which is true only while one specific arc is actively drawn (its own
 *  travel window plus a short fade tail) and so flickers off between arrivals even though human
 *  dispersal, once begun, never un-happens. Feeds the "Human civilisation" legend row's
 *  visibility alongside `citiesHaveDataAt`, which is already a domain check. */
function arrivalsInDomainAt(events: readonly TimelineEvent[], t: GeoTime): boolean {
  for (const event of events) {
    if (event.effect?.kind === 'arrival' && t <= arrivalWindow(event.effect)[1]) return true
  }
  return false
}

/** The overlay uniform's channel weights and log ceiling for `sampling`, exhaustive over
 *  `OverlaySampling` so a new sampling mode is a compile error here rather than a silent alias
 *  onto an existing one — the shape `overlay.ts`'s own `overlayKindUniform` already follows.
 *  `dMax` is meaningless for `linear_fraction` (the shader's density branch alone reads it). */
function overlayChannelAndDMax(
  sampling: OverlaySampling,
  data: RasterData,
): { channel: readonly [number, number, number]; dMax: number } {
  switch (sampling.mode) {
    case 'log_encoded':
      return { channel: densityChannelMask(data.encoding?.channel ?? 'r'), dMax: data.encoding?.dMax ?? 1 }
    case 'linear_fraction':
      return { channel: sampling.weights, dMax: 0 }
  }
}

export function Globe({
  t,
  rasterLayers,
  assetBase,
  regimeEvents,
  effectEvents,
  iceAgeLayers,
  expanded,
  onToggleExpand,
  onCaptionChange,
  cities,
  empires,
  sceneLocation,
  playbackBaseRate,
  cityLabelFadeWindowAt,
  feedEventIds,
  hoveredFeedEventId,
  onViewModeToggleHeightChange,
  onActivateEvent,
  onActivateEmpire,
  selectedEmpire = null,
}: GlobeProps) {
  // One throwaway canvas/context answers both "does WebGL work at all" and (below) "can this
  // GPU hold a T1 basemap texture" — `probeWebgl`'s own doc comment has the full story on why
  // this replaced two separate calls, each opening its own throwaway context.
  const webglProbe = useMemo(() => probeWebgl(), [])
  const webgl = webglProbe.supported
  const blend = useMemo(() => globeMultiBlendAt(rasterLayers, t, assetBase), [rasterLayers, t, assetBase])
  const domain = globeUniforms(blend)
  const direction = useTravelDirection(t)
  const preloadUrls = useMemo(
    () => globeMultiPreloadUrls(rasterLayers, t, direction, PRELOAD_WINDOW, assetBase),
    [rasterLayers, t, direction, assetBase],
  )

  // docs/GLOBE.md's ADR-030 (amended): the human-era basemap tier — T0 for the minimised orb,
  // T1 once expanded on any device whose GPU can hold it (`selectBasemapTier`), phone included.
  // `basemapData` is `null` whenever no basemap layer is published at all, or the chosen tier
  // specifically isn't (falls back to T0's own RasterData, never to `null` just because T1 alone
  // is missing).
  const isPhoneViewport = useIsPhoneViewport()
  const t1Available = useMemo(() => supportsBasemapT1(webglProbe.maxTextureSize), [webglProbe])
  const basemapTier = selectBasemapTier(expanded, t1Available)
  const basemapData =
    basemapTier === 'basemap_t1' && rasterLayers.basemapT1 !== null ? rasterLayers.basemapT1 : rasterLayers.basemapT0
  // Well inside the basemap's own span, the PaleoDEM LRU is trimmed down to just the 0 Ma
  // frame(s) — reusing `basemapStrengthAt`'s own band rather than a second threshold, since
  // "well inside" and "the basemap is the whole picture" (strength 1) are the same condition.
  const wellInsideHumanEra = basemapData !== null && basemapStrengthAt(t) >= 1
  const pair = useGlobeTexturePair(blend, preloadUrls, { enabled: webgl, aggressiveTrim: wellInsideHumanEra })

  // The human-era caches' own textures can't survive a WebGL context loss the way the
  // PaleoDEM/Merdith cache's can (`HumanEraTextureCache.clear`'s own doc comment on why — their
  // backing `ImageBitmap`s are already closed). `GlobeSphere` calls `onWebglContextRestored` the
  // moment `webglcontextrestored` fires on the renderer's canvas; bumping `contextEpoch` forces
  // the two `useGlobeTexturePair` calls below (via their `resetKey` option) to re-fetch even
  // though their blend's URLs haven't changed.
  const [contextEpoch, setContextEpoch] = useState(0)
  const empireCacheRef = useRef<EmpireTextureCache | null>(null)
  const onWebglContextRestored = (): void => {
    basemapTextureCache.clear()
    densityTextureCache.clear()
    empireCacheRef.current?.clear()
    setContextEpoch((epoch) => epoch + 1)
  }
  // Gates the shader's textured look: even in-domain, don't show data until the first pair
  // has actually loaded. Distinct from `domain.hasData`, which alone decides the raster
  // fallback caption below — that must reflect the *domain*, not load state, or it would
  // falsely claim "no reconstruction" while in-domain textures are still in flight.
  const showTexture = domain.hasData && pair.texturesReady
  const mix = showTexture ? pair.mix : 0

  // The basemap texture itself is time-invariant per tier (`blend.ts`'s `basemapStrengthAt` doc
  // comment) — one texture, resolved at its own t=0 frame (before === after there) rather than
  // bracketed against t, and bound through its own mipmapped, byte-capped cache
  // (`humanEraTextureCache.ts`) so switching tiers on expand/collapse gets the same "keep the
  // old one bound until the new one is ready" discipline `useGlobeTexturePair` already gives
  // the PaleoDEM pair — never a blank or flashed frame. Fetching/decoding a several-MB basemap
  // texture is only worth it once `t` is within reach of `BASEMAP_CROSSFADE_BAND`'s own domain —
  // a session that never scrubs near the present would otherwise still pay for a texture it
  // never shows.
  const basemapWanted = t <= BASEMAP_FETCH_MARGIN_YEARS
  const basemapBlend = useMemo(
    () => (basemapData === null || !basemapWanted ? null : globeBlendAt(basemapData, 0, assetBase)),
    [basemapData, assetBase, basemapWanted],
  )
  const basemapPair = useGlobeTexturePair(basemapBlend, [], { enabled: webgl, cache: basemapTextureCache, resetKey: contextEpoch })
  const basemapStrength = basemapData !== null && basemapPair.texturesReady ? basemapStrengthAt(t) : 0

  // The human-civilisation layer (ADR-031 amendment / ADR-032 / ADR-035): transient arrival arcs
  // and city markers, under one toggle. `arrivalTiming` is derived from the timeline's own
  // playback rate once, not per frame — see `arrivalTimingFor`.
  //
  // Forced on for a phone viewer: `<Legend>` — the only way to switch it off — never renders on
  // a phone at all (below), so `rawHumanOn`'s own state would otherwise be unreachable-but-stale
  // if it had been switched off on a wider window before the viewport narrowed. Deriving `humanOn`
  // this way makes "off on a phone" unrepresentable rather than merely unreachable through the UI.
  const [rawHumanOn, setHumanOn] = useState(true)
  const humanOn = isPhoneViewport || rawHumanOn
  const arrivalTiming = useMemo(() => arrivalTimingFor(playbackBaseRate), [playbackBaseRate])
  const humanHasData = arrivalsInDomainAt(effectEvents, t) || citiesHaveDataAt(cities, t) || empiresHaveDataAt(empires, t)

  // The globe's single raster-overlay slot (ADR-041): independent of the People toggle above —
  // turning arcs/cities off does not hide whichever overlay is selected, and vice versa.
  // `'population_density'` is the default, matching the wash this feature originally shipped
  // with alone. `available` (passed to `<OverlaySelect>` below) is derived from which layers the
  // manifest actually published, not from data presence at the current `t` — an option list that
  // changes while scrubbing would be worse than an option that paints nothing for a while.
  const [overlayKind, setOverlayKind] = useState<GlobeOverlayKind | null>('population_density')
  const availableOverlayKinds = useMemo(
    () => GLOBE_OVERLAY_KINDS.filter((kind) => rasterLayers.overlayRasters.has(GLOBE_OVERLAYS[kind].layerId)),
    [rasterLayers],
  )
  const overlaySpec = overlayKind !== null ? GLOBE_OVERLAYS[overlayKind] : null
  const overlayData = overlaySpec !== null ? (rasterLayers.overlayRasters.get(overlaySpec.layerId) ?? null) : null

  // The overlay's own texture pair, on its own `NoColorSpace`/box-filtered cache
  // (`humanEraTextureCache.ts`) — nothing is fetched while no overlay is selected or `t` is
  // outside the selected layer's own domain, since `overlayBlendAt` returns null for both.
  const overlayBlend = useMemo(
    () => (overlayData === null ? null : overlayBlendAt(overlayData, t, assetBase)),
    [overlayData, t, assetBase],
  )
  const overlayPair = useGlobeTexturePair(overlayBlend, [], {
    enabled: webgl,
    cache: densityTextureCache,
    resetKey: contextEpoch,
    sourceKey: overlaySpec?.layerId ?? '',
  })
  // `sourceKey` keeps `texturesReady` false across a kind switch until the new kind's pair has
  // loaded, so the previous kind's bytes are never decoded through the new kind's channel/ramp.
  const overlayStrength = overlayData !== null && overlayPair.texturesReady ? overlayStrengthAt(overlayData, t) : 0
  const overlaySampling = useMemo(
    () => (overlaySpec !== null && overlayData !== null ? overlayChannelAndDMax(overlaySpec.sampling, overlayData) : null),
    [overlaySpec, overlayData],
  )
  const overlayChannel = overlaySampling?.channel ?? DEFAULT_OVERLAY_CHANNEL
  const overlayDMax = overlaySampling?.dMax ?? 1
  const overlayKindValue = overlaySpec !== null ? overlayKindUniform(overlaySpec.kind) : 0

  // Historical empires (ADR-059), part of the human-civilisation layer. The active set is a step
  // function of `t` (`empireSnapshotsAt`); only the crossfade between two sets runs on wall-clock
  // time (`usePresentedMix`). Each presented set is rasterised into its own texture through
  // `useGlobeTexturePair`, keyed by set, tier, fill and highlight. The fill shows only while no raster
  // overlay is selected; over an overlay's ramp the outlines and labels carry the layer alone.
  const empireFrame = useMemo(() => (empires === null ? NO_EMPIRE_FRAME : empireSnapshotsAt(empires, t)), [empires, t])
  const empireTarget = useMemo((): Mix<EmpireFrame> => ({ from: empireFrame, to: empireFrame, mix: 1 }), [empireFrame])
  const presentedEmpires = usePresentedMix(empireTarget, EMPIRE_CROSSFADE_SECONDS, EMPIRE_FRAME_KEYING)
  const empiresInDomain = empiresHaveDataAt(empires, t)
  const empireGeometry = useEmpireGeometry(
    empires,
    empires === null ? null : resolveAssetUrl(assetBase, empires.data.geometry),
    webgl && empires !== null && t <= empires.domain[1] + EMPIRE_FETCH_MARGIN_YEARS,
  )
  const empireCache = useMemo(
    () => (empires !== null && empireGeometry !== null ? createEmpireTextureCache(empires, empireGeometry) : null),
    [empires, empireGeometry],
  )
  useEffect(() => {
    empireCacheRef.current = empireCache
    return () => empireCache?.clear()
  }, [empireCache])
  const empireTier = selectEmpireTier(expanded, t1Available)
  const empireFill = overlayKind === null
  // The hovered lineage, else the one whose panel is open, is emphasised in the texture itself
  // (expanded only). Hover reaches here settled (`EMPIRE_HOVER_SETTLE_MS`), so the painter runs
  // once per lineage the pointer rests on.
  const [hoveredEmpire, setHoveredEmpire] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onHoverEmpire = useCallback((lineage: string | null) => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      setHoveredEmpire(lineage)
    }, EMPIRE_HOVER_SETTLE_MS)
  }, [])
  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
    },
    [],
  )
  const empireHighlight = expanded && humanOn ? (hoveredEmpire ?? selectedEmpire) : null
  const empireBlend = useMemo((): GlobeBlend | null => {
    if (empireCache === null || !humanOn) return null
    const keyFor = (frame: EmpireFrame): string =>
      empireTextureKey({ frameKey: frame.key, tier: empireTier, fill: empireFill, highlight: empireHighlightIn(frame, empireHighlight) })
    return { beforeUrl: keyFor(presentedEmpires.from), afterUrl: keyFor(presentedEmpires.to), alpha: presentedEmpires.mix }
  }, [empireCache, humanOn, presentedEmpires, empireTier, empireFill, empireHighlight])
  // A pair bound before the layer was hidden belongs to whatever `t` it was hidden at, so each
  // hide starts a new epoch in `sourceKey`: re-showing the layer reads as nothing bound until the
  // current frame's pair loads, rather than drawing the old territories under current labels.
  const [empireEpoch, setEmpireEpoch] = useState(0)
  useEffect(() => {
    if (!humanOn) setEmpireEpoch((epoch) => epoch + 1)
  }, [humanOn])
  const empirePair = useGlobeTexturePair(empireBlend, [], {
    enabled: webgl,
    cache: empireCache ?? NO_EMPIRE_CACHE,
    resetKey: contextEpoch,
    sourceKey: `${empires?.data.geometry ?? ''}|${empireEpoch}`,
  })
  // Outside the domain the presented set is empty, so the texture itself fades the layer out.
  const empireStrength = humanOn && empirePair.texturesReady ? 1 : 0
  const showEmpireLabels = expanded && humanOn && empiresInDomain && empirePair.texturesReady
  const empireLabelCap = isPhoneViewport ? EMPIRE_LABEL_CAP_PHONE : EMPIRE_LABEL_CAP_DESKTOP
  const empireLabels = useMemo(
    () => (showEmpireLabels ? { presented: presentedEmpires, cap: empireLabelCap } : null),
    [showEmpireLabels, presentedEmpires, empireLabelCap],
  )
  // The hit test answers for what is drawn at `t`, expanded only, like the labels.
  const empireHits = useMemo(
    () => (showEmpireLabels && empires !== null && empireGeometry !== null ? { index: empires, frame: empireFrame, geometry: empireGeometry } : null),
    [showEmpireLabels, empires, empireFrame, empireGeometry],
  )

  // ADR-034: the scene's own plotted position. `sceneMarkerCoordinates` is the single place the
  // "never fall back to presentDay" rule lives. The small orb eases its rotation to centre it;
  // expanded or unfolded as a map the viewer is steering, so no focus target is passed at all and
  // the camera is left entirely alone. Only the longitude crosses this boundary — the rotation
  // that actually centres it also depends on the camera's own current azimuth, which
  // `useGlobeAutoRotationY` reads itself, inside the `<Canvas>`, from the one place that owns the
  // camera (see that hook's own doc comment).
  const sceneMarker = sceneMarkerCoordinates(sceneLocation ?? undefined)
  const sceneFocusLon = !expanded && sceneMarker !== null ? sceneMarker.lon : null

  // Set while a touch press lands on one of the human layer's own targets, so the orb's
  // tap-to-expand gesture stands down and the tap opens a tooltip instead.
  const humanTouchHitRef = useRef(false)

  // docs/GLOBE.md G7's fallback rule: when Merdith data is unusable, 540-1000 Ma gets the same
  // "geography unknown" regime look that already covers 1000 Ma and older, not fake continents.
  const effectiveRegimeEvents = useMemo(
    () => regimeEventsWithRasterFallback(regimeEvents, rasterLayers.neoproterozoic !== null),
    [regimeEvents, rasterLayers.neoproterozoic],
  )
  const iceAge = useIceAge(t, iceAgeLayers)
  const fallbackCaption = useMemo(
    () => iceAge.caption || globeMultiCaptionFor(rasterLayers, t),
    [iceAge.caption, rasterLayers, t],
  )
  const effects = useGlobeEffects(t, effectiveRegimeEvents, effectEvents, fallbackCaption)
  const caption = effects.caption

  // The three gestures that collapse an expanded globe (✕, Escape, backdrop click — every path
  // that reaches `onToggleExpand` while `expanded` is true, since the expand-only paths below are
  // themselves gated on `!expanded`). Resets `mapMode` synchronously, in the same event as
  // `onToggleExpand`'s own state update, so React 18's automatic batching applies both in one
  // render — a plain `useEffect` alone runs one render later, which is late enough to let the
  // tiny minimised orb briefly render mid-map-mode and play the fold tween.
  const onCollapse = (): void => {
    setMapMode(false)
    onToggleExpand()
  }

  useCaptionReport(caption, onCaptionChange)
  useCloseOnEscape(expanded, onCollapse)

  // `viewModeToggleRef`'s own doc comment (`useViewModeToggleHeightReport`, below).
  const viewModeToggleRef = useRef<HTMLDivElement | null>(null)
  // Not on a phone: there the toggle shares its own row with the zoom rocker
  // (`Globe.module.css`'s own phone `.viewModeGroup`/`.zoomGroup` rule), and the row's real height
  // is reserved through `ShellLayout.module.css`'s own literal `--controls-row-reserve` instead —
  // sized to the taller of the two controls (the zoom rocker), which a live measurement of the
  // shorter toggle pill alone would under-report.
  useViewModeToggleHeightReport(viewModeToggleRef, expanded && webgl && !isPhoneViewport, onViewModeToggleHeightChange)

  // The Globe/Map toggle (docs/GLOBE.md's ADR-033): local, Globe-owned UI state rather
  // than lifted to the time store — like the About & credits panel's own `aboutOpen`
  // (`ShellLayout.tsx`), this is pure chrome with no bearing on playback or `t`. Only available
  // expanded, and collapsing always returns to the sphere: re-expanding never resumes a stale
  // map view the viewer didn't ask for this time.
  const [mapMode, setMapMode] = useState(false)
  useEffect(() => {
    // Fallback only: the three collapse gestures below (✕, Escape, backdrop click) already
    // reset `mapMode` synchronously in the same event, in the same batch as `onToggleExpand`'s
    // own `expanded` update, so this effect is a no-op for them by the time it runs. It still
    // matters for any other path that collapses `expanded` from outside this component.
    if (!expanded) setMapMode(false)
  }, [expanded])
  const reducedMotion = useReducedMotion()
  // `!expanded` forces an instant snap, not just `reducedMotion`: without it, the one render
  // between `expanded` turning false and the fallback effect above resetting `mapMode` would
  // play part of the fold-back tween inside the now-tiny minimised orb. The three collapse
  // handlers above reset `mapMode` in the same batch as `expanded`, so by the time this evaluates
  // on that render both are already consistent and the snap is a no-op past the very first
  // frame — but it still guards the fallback path above.
  const unfold = useUnfold(mapMode, reducedMotion || !expanded)

  // Closing on a backdrop click only when the press also *started* on the backdrop: a drag
  // that rotates the globe and happens to be released outside it must not dismiss it.
  const pressStartedOnBackdrop = useRef(false)
  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    pressStartedOnBackdrop.current = e.target === e.currentTarget
  }
  const onBackdropClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onCollapse()
  }

  // Minimised orb: OrbitControls rotates in both states, so a plain expand button covering the
  // orb would swallow every drag. Instead the orb tells a press from a drag by movement, the same
  // "did the press move" test the backdrop uses above. OrbitControls captures the pointer on the
  // canvas (three.js's `setPointerCapture`), so pointerup and click still bubble here even when
  // released outside the orb. The expand itself runs on the orb's `click`, not on pointerup:
  // expanding re-lays out the page (on a phone the era shortcuts move to where the orb was), and a
  // touch's `click` is hit-tested after that re-layout, so expanding any earlier would let the
  // same tap land on whatever now sits under the finger. `expandButton` below stays for keyboard
  // activation only, and stops its own click here so it never counts twice.
  const orbPressStart = useRef<{ x: number; y: number } | null>(null)
  const orbClickPending = useRef(false)
  const onOrbPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    orbPressStart.current = { x: e.clientX, y: e.clientY }
    orbClickPending.current = false
  }
  const onOrbPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const start = orbPressStart.current
    orbPressStart.current = null
    orbClickPending.current = start !== null && !humanTouchHitRef.current && isOrbClick(start, { x: e.clientX, y: e.clientY })
  }
  const onOrbClick = (): void => {
    if (!orbClickPending.current) return
    orbClickPending.current = false
    onToggleExpand()
  }
  const onExpandButtonClick = (e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    orbClickPending.current = false
    onToggleExpand()
  }

  // The narrow-viewport safety net for the top-right overlay-selector stack (`ViewModeToggle` and
  // `<Legend>` live in their own corners now, see their own doc comments): on a phone this stack
  // is wide enough that its own edge can sit past the *centre* of a narrow viewport, which a
  // centred sphere or map straddles by construction; on a wider-but-still-narrow desktop/tablet
  // width the map's own ~2.05:1 rectangle reaches far enough sideways to grow up underneath it
  // too. `Globe.module.css`'s own narrow-viewport rules read `--overlay-clear-bottom` (this
  // stack's own real drawn bottom edge) to keep the sphere/map from growing underneath it — see
  // those rules' own doc comments for why a simple "clear it vertically altogether" bound, not
  // exact circle geometry, is what's actually applied. Measured directly on the DOM (not
  // estimated), the same `getBoundingClientRect` + `ResizeObserver` + `window.resize` recipe
  // `useChromeGap` uses, written onto `backdropRef`'s own element (an ancestor of both, in the
  // same position: fixed/viewport coordinate space) rather than routed through React state, for
  // the same "don't re-render every playback frame for a value nothing here reads reactively"
  // reason.
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const overlaySelectBoundsRef = useRef<HTMLDivElement | null>(null)
  // The top-left legend corner's own bounds, measured the same way and for the same reason as
  // `overlaySelectBoundsRef` above — its mirror image on the opposite side of the title. Feeds
  // `--legend-clear-bottom` below, the sphere/map's own top-clearance term for this corner.
  const legendCornerRef = useRef<HTMLDivElement | null>(null)
  // The zoom rocker's own bounds — sharing the bottom row with `viewModeToggleRef` but a few px
  // taller (its own doc comment below), so its top edge can sit above the toggle's. Both feed
  // `--bottom-corner-clear-top` below; the sphere/map must stop short of whichever starts higher.
  const zoomGroupRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  // `Globe.module.css`'s `.orbFitFrameSphere`/`.orbFitFrameMap` — invisible, `pointer-events:
  // none` boxes carrying the *old* `.orbExpanded` sizing formulas verbatim (that class's own doc
  // comment on why: the canvas itself is now full-bleed, so something else has to say what size
  // the default sphere/map framing should still look). Measured the same way as
  // `--overlay-clear-bottom` just below — `GlobeCameraControls` (inside the `<Canvas>`, a
  // separate react-three-fiber tree with no DOM access of its own) receives the numbers as props.
  const sphereFitFrameRef = useRef<HTMLDivElement | null>(null)
  const mapFitFrameRef = useRef<HTMLDivElement | null>(null)
  const [fitMeasurements, setFitMeasurements] = useState<FitMeasurements>(EMPTY_FIT_MEASUREMENTS)
  useEffect(() => {
    const host = backdropRef.current
    if (host === null) return undefined
    const recompute = (): void => {
      const overlaySelectRect = overlaySelectBoundsRef.current?.getBoundingClientRect() ?? null
      host.style.setProperty('--overlay-clear-bottom', `${overlaySelectRect?.bottom ?? 0}px`)
      host.style.setProperty('--overlay-clear-right', `${overlaySelectRect?.right ?? 0}px`)

      const legendBottom = legendCornerRef.current?.getBoundingClientRect().bottom ?? 0
      host.style.setProperty('--legend-clear-bottom', `${legendBottom}px`)

      // Read in dependency order: each `getBoundingClientRect` below forces a layout that already
      // reflects the properties set above it. In the landscape layout the toggle sits under the
      // overlay stack and the zoom rocker beside the toggle, so a stale read would leave the zoom
      // rocker's own edge (and so the sphere/map box beside it) one pass behind.
      const toggleRect = viewModeToggleRef.current?.getBoundingClientRect() ?? null
      host.style.setProperty('--view-toggle-clear-right', `${toggleRect?.right ?? 0}px`)
      const zoomRect = zoomGroupRef.current?.getBoundingClientRect() ?? null
      const viewControlRects = [toggleRect, zoomRect].filter((rect): rect is DOMRect => rect !== null)
      if (viewControlRects.length > 0) {
        host.style.setProperty('--bottom-corner-clear-top', `${Math.min(...viewControlRects.map((rect) => rect.top))}px`)
        host.style.setProperty('--view-controls-clear-right', `${Math.max(...viewControlRects.map((rect) => rect.right))}px`)
      } else {
        host.style.removeProperty('--bottom-corner-clear-top')
        host.style.removeProperty('--view-controls-clear-right')
      }
      const closeLeft = closeButtonRef.current?.getBoundingClientRect().left ?? null
      if (closeLeft !== null) host.style.setProperty('--close-clear-left', `${closeLeft}px`)
      else host.style.removeProperty('--close-clear-left')

      const canvasRect = host.getBoundingClientRect()
      // `?? null` down to a real, non-degenerate rect only: a frame's *very first*
      // `ResizeObserver` pass can report a real-but-zero-height rect for the one paint before its
      // ancestor's `--chrome-gap-height` custom property has resolved. Keeping it `null` here
      // means every consumer's existing "not measured yet" fallback also covers this case,
      // instead of each needing its own separate `height > 0` guard.
      const sphereRectRaw = sphereFitFrameRef.current?.getBoundingClientRect() ?? null
      const sphereRect = sphereRectRaw !== null && sphereRectRaw.height > 0 ? sphereRectRaw : null
      const mapRectRaw = mapFitFrameRef.current?.getBoundingClientRect() ?? null
      const mapRect = mapRectRaw !== null && mapRectRaw.height > 0 ? mapRectRaw : null
      setFitMeasurements({
        sphereFit: sphereRect !== null ? { width: sphereRect.width, height: sphereRect.height } : null,
        mapFit: mapRect !== null ? { width: mapRect.width, height: mapRect.height } : null,
        // Both frames are centred on the same point regardless of their own width/height, so
        // one offset — read from whichever frame is currently mounted — serves both sphere and
        // map framing; `sphereFit` is measured first, but either would agree.
        centerOffsetPx:
          sphereRect !== null
            ? centerOffset(sphereRect, canvasRect)
            : mapRect !== null
              ? centerOffset(mapRect, canvasRect)
              : { x: 0, y: 0 },
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute)
      observer.observe(host)
      for (const ref of [
        overlaySelectBoundsRef,
        legendCornerRef,
        viewModeToggleRef,
        zoomGroupRef,
        closeButtonRef,
        sphereFitFrameRef,
        mapFitFrameRef,
      ]) {
        if (ref.current !== null) observer.observe(ref.current)
      }
    }
    return () => {
      window.removeEventListener('resize', recompute)
      observer?.disconnect()
    }
    // Re-runs whenever any observed element could have just mounted or unmounted (a
    // `ResizeObserver` can only watch a node once it exists) — `expanded`/`webgl` gate all of
    // them.
  }, [expanded, webgl])

  // `ZoomControls` below is plain DOM, outside the `<Canvas>`'s own react-three-fiber tree, so it
  // drives `GlobeCameraControls`'s camera
  // through this imperative ref rather than a second, parallel zoom state; `zoomBounds` is
  // reported back the same way `caption`/`onWebglContextRestored` already cross that boundary.
  const cameraApiRef = useRef<GlobeCameraApi>(null)
  const sphereRotationYRef = useRef(0)
  const [zoomBounds, setZoomBounds] = useState<ZoomBounds>({ canZoomIn: true, canZoomOut: true })
  const expandedDpr = useExpandedCanvasDpr(expanded)

  // The element types and order stay identical across both states so toggling restyles the
  // same <Canvas> rather than remounting it (a new WebGL context and texture re-upload).
  return (
    <div
      ref={backdropRef}
      className={expanded ? styles.backdrop : styles.root}
      onPointerDown={expanded ? onBackdropPointerDown : undefined}
      onClick={expanded ? onBackdropClick : undefined}
    >
      <div
        className={[expanded ? styles.orbExpanded : styles.orb, webgl ? '' : styles.orbNoWebgl].filter(Boolean).join(' ')}
        data-map-mode={mapMode}
        data-empires-bound={empireBlend !== null && empirePair.blendBound}
        style={ORB_STYLE}
        onPointerDown={expanded ? undefined : onOrbPointerDown}
        onPointerUp={expanded ? undefined : onOrbPointerUp}
        onClick={expanded ? undefined : onOrbClick}
      >
        {/* The two invisible fit-target rectangles (`Globe.module.css`'s own doc comment) —
            mounted only while expanded, since the minimised orb has no clip to remove and keeps
            its own simple 100%/100% `.orb` sizing untouched below. `.halo` and the no-WebGL
            fallback both nest inside the sphere one specifically, so they keep sitting exactly
            where the sphere's default silhouette does rather than growing to the now-full-bleed
            canvas (`.orbFitFrameSphere`'s own doc comment). Each is its own top-level slot (not
            nested inside a single shared conditional with the `<Canvas>` below) precisely so
            `<Canvas>` keeps the same sibling index regardless of `expanded` — see this
            component's own "element types and order stay identical" note below. */}
        {expanded && (
          <div ref={sphereFitFrameRef} className={styles.orbFitFrameSphere} aria-hidden="true" data-testid="globe-sphere-fit-frame">
            <div className={styles.halo} aria-hidden="true" />
            {!webgl && <GlobeStaticOrb />}
          </div>
        )}
        {expanded && (
          <div ref={mapFitFrameRef} className={styles.orbFitFrameMap} aria-hidden="true" data-testid="globe-map-fit-frame" />
        )}
        {!expanded && <div className={styles.halo} aria-hidden="true" />}
        {webgl ? (
          <Canvas
            camera={{ position: [0, 0, CAMERA_DISTANCE], fov: CAMERA_FOV_DEG }}
            dpr={expanded ? expandedDpr : MINIMISED_DPR}
            gl={{ alpha: true }}
            // The full-bleed canvas (`Globe.module.css`'s `.orbExpanded` doc comment) is mostly
            // transparent (`alpha: true`) around the sphere/map, so a click there must still read
            // as "clicked the dimmed backdrop, close the view" the way it did when a bare
            // `.backdrop` click handler (below) could still see raw backdrop pixels around a much
            // smaller box. r3f's own `onPointerMissed` is the right primitive for exactly this: it
            // fires only for a `click`/`contextmenu`/`dblclick`-type event whose raycast hit
            // nothing, gated by r3f's own `delta <= 2px` movement check since pointerdown — so a
            // rotate-drag that happens to release over empty canvas (a real risk once the canvas
            // is this large) never triggers it, matching the existing backdrop-click guard's own
            // "a drag must not dismiss it" rule one level down, at the canvas itself. `onCollapse`
            // only while `expanded`: minimised, a miss must do nothing (the orb's own
            // `onOrbPointerUp`/`onOrbClick` above already own click-to-expand there, and
            // calling `onCollapse` — which unconditionally toggles — while collapsed would flip it
            // open by mistake). Only plain clicks close it, not right-click/double-click, matching
            // the old `onClick`-only backdrop handler.
            onPointerMissed={(event) => {
              if (expanded && event.type === 'click') onCollapse()
            }}
          >
            <GlobeRotatingGroup
              unfold={unfold}
              reducedMotion={reducedMotion}
              focusLon={sceneFocusLon}
              sphereRotationYRef={sphereRotationYRef}
            >
              <GlobeSphere
                beforeTex={pair.beforeTex}
                afterTex={pair.afterTex}
                mix={mix}
                hasData={showTexture}
                effects={effects.uniforms}
                iceAge={iceAge.state}
                unfold={unfold}
                mapMode={mapMode}
                basemapTex={basemapPair.beforeTex}
                basemapStrength={basemapStrength}
                overlayKind={overlayKindValue}
                overlayBeforeTex={overlayPair.beforeTex}
                overlayAfterTex={overlayPair.afterTex}
                overlayMix={overlayPair.mix}
                overlayStrength={overlayStrength}
                overlayChannel={overlayChannel}
                overlayDMax={overlayDMax}
                empireBeforeTex={empirePair.beforeTex}
                empireAfterTex={empirePair.afterTex}
                empireMix={empirePair.mix}
                empireStrength={empireStrength}
                onWebglContextRestored={onWebglContextRestored}
              />
              {/* Both siblings of the same `GlobeRotatingGroup` (see its own doc comment for why
                  that parenting, not a shared rotation ref, is what actually keeps them in sync).
                  Rendered after GlobeSphere so its fragments are depth-tested against the sphere's
                  own already-written depth buffer for this frame: depth testing decides per-
                  fragment visibility regardless of draw order — draw order only decides which
                  depth values are already in the buffer to test against, and GlobeSphere drawing
                  first is what guarantees the far-side sphere's depths are there to test an arc's
                  fragments against. */}
              <HumanCivilisation
                t={t}
                effectEvents={effectEvents}
                cities={cities}
                unfold={unfold}
                radius={GLOBE_RADIUS}
                expanded={expanded}
                enabled={humanOn}
                timing={arrivalTiming}
                feedEventIds={feedEventIds}
                hoveredFeedEventId={hoveredFeedEventId}
                sceneMarker={sceneMarker}
                reducedMotion={reducedMotion}
                touchHitRef={humanTouchHitRef}
                onActivateEvent={onActivateEvent}
                cityLabelFadeWindowAt={cityLabelFadeWindowAt}
                empires={empireHits}
                empireLabels={empireLabels}
                selectedEmpire={selectedEmpire}
                onActivateEmpire={onActivateEmpire}
                onHoverEmpire={onHoverEmpire}
              />
            </GlobeRotatingGroup>
            <AtmosphereRim unfold={unfold} />
            <PoleAxisMarkers unfold={unfold} />
            <GlobeCameraControls
              ref={cameraApiRef}
              expanded={expanded}
              mapMode={mapMode}
              unfold={unfold}
              sphereFit={fitMeasurements.sphereFit}
              mapFit={fitMeasurements.mapFit}
              centerOffsetPx={fitMeasurements.centerOffsetPx}
              onZoomBoundsChange={setZoomBounds}
              sphereRotationYRef={sphereRotationYRef}
            />
          </Canvas>
        ) : (
          // Expanded, the no-WebGL fallback instead renders inside `.orbFitFrameSphere` above
          // (that block's own comment) — this slot only fires minimised, unchanged from before.
          !expanded && <GlobeStaticOrb />
        )}

        {/* Persistent "this expands" affordance: `.expandButton`'s own ring below only shows on
            hover/focus, which is invisible to a viewer who never hovers — exactly the viewer the
            affordance is for. Decorative only (`aria-hidden`): the accessible name and the
            keyboard/focus-ring path both stay on `.expandButton` immediately below, unchanged. */}
        {!expanded && (
          <svg
            className={styles.expandGlyph}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
        {!expanded && (
          <button
            type="button"
            className={styles.expandButton}
            onClick={onExpandButtonClick}
            aria-label="Expand globe"
            // The anchor the onboarding tour rings for its "the globe opens" step: a circle inset
            // inside the orb's box, so the ring traces the orb rather than a square around it.
            data-testid="globe-expand"
          />
        )}
      </div>

      {/* WebGL-off fallback (`GlobeStaticOrb`) has no map to unfold into, and no overlay data
          to show either — every control below is hidden outright, never shown disabled or
          faked. */}
      {expanded && webgl && <ViewModeToggle mapMode={mapMode} onChange={setMapMode} heightRef={viewModeToggleRef} />}
      {/* Top-right stack (ADR-041 item 7), under the ✕: the raster-overlay selector. Renders on
          both phone and desktop (it is the *only* overlay control on a phone, `<Legend>` never
          shows there — see `<Legend>`'s own corner below). `overlaySelectBoundsRef` measures this
          wrapper directly, so `--overlay-clear-bottom` reflects this corner alone. `compact`
          (suppressing the ramp key) on a phone only: at the 390/412px floor row 2 has no room to
          spare for it — desktop has the room. */}
      {expanded && webgl && (
        <div ref={overlaySelectBoundsRef} className={styles.overlaySelectStack} data-testid="globe-overlay-select-stack">
          <OverlaySelect
            value={overlayKind}
            onChange={setOverlayKind}
            available={availableOverlayKinds}
            compact={isPhoneViewport}
          />
        </div>
      )}
      {/* Top-left corner: the "Human civilisation" legend toggle, the mirror image of the overlay
          stack above. Desktop only — a phone viewer never sees it at all (`humanOn`'s own doc
          comment above forces the layer on there instead, since there is nothing to toggle it
          with) — so this corner is simply absent on a phone rather than needing its own phone
          positioning rule. `legendCornerRef` feeds `--legend-clear-bottom` (`backdropRef`'s own
          effect above), so the sphere/map can never grow up underneath this corner. */}
      {expanded && webgl && !isPhoneViewport && (
        <div ref={legendCornerRef} className={styles.legendCorner} data-testid="globe-legend-corner">
          <Legend
            rows={[
              {
                id: 'human-civilisation',
                label: 'Human civilisation',
                hint: 'Dispersal arcs, settlements, cities and empires.',
                on: humanOn,
                onChange: setHumanOn,
                visible: humanHasData,
              } satisfies LegendRow,
            ]}
          />
        </div>
      )}

      {expanded && webgl && (
        <ZoomControls
          onZoomIn={() => cameraApiRef.current?.zoomIn()}
          onZoomOut={() => cameraApiRef.current?.zoomOut()}
          canZoomIn={zoomBounds.canZoomIn}
          canZoomOut={zoomBounds.canZoomOut}
          groupRef={zoomGroupRef}
        />
      )}

      {expanded && (
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.closeButton}
          onClick={onCollapse}
          aria-label="Collapse globe"
          data-testid="globe-close-button"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------- view mode

interface ViewModeToggleProps {
  mapMode: boolean
  onChange: (mapMode: boolean) => void
  /** `useViewModeToggleHeightReport`'s own measurement target — see that hook's doc comment. */
  heightRef: RefObject<HTMLDivElement | null>
}

/** "Globe / Map" segmented control (docs/GLOBE.md's ADR-033). Only rendered while expanded
 *  (`Globe`'s own guard) — collapsing always resets `mapMode`, so this never needs to reflect a
 *  "sticky" map view when it reappears.
 *
 *  No visible label above the buttons: "Globe"/"Map" already say what the buttons do, unlike
 *  `timeline/components/Transport.tsx`'s "Playback mode"/"Scale" controls, which name something
 *  the button text alone wouldn't. The group's accessible name comes from a direct `aria-label`
 *  rather than `aria-labelledby`, since there is no separate label element to point at.
 *
 *  Positioned bottom-left, its own left edge lined up with the scrub track's left edge
 *  (`Globe.module.css`'s `.viewModeGroup`, its own doc comment has the placement maths) — the two
 *  top corners (the overlay selector and the "Human civilisation" legend) still need clearance
 *  protection (`Globe`'s own doc comment on `overlaySelectBoundsRef`/`legendCornerRef`).
 *  `heightRef` reports this element's own real height up to `ShellLayout` so the expanded
 *  sphere/map sizes itself into what's left over once this band is reserved
 *  (`useViewModeToggleHeightReport`). `data-testid` gives the QA harness a stable selector
 *  independent of the CSS-module-hashed class name. */
function ViewModeToggle({ mapMode, onChange, heightRef }: ViewModeToggleProps) {
  return (
    <div ref={heightRef} className={styles.viewModeGroup} data-testid="globe-view-mode-group">
      {/* No separate label element any more — the group names itself via `aria-label` instead. */}
      <div className={styles.viewModeToggle} role="group" aria-label="Globe/Map view">
        <button type="button" className={styles.viewModeButton} aria-pressed={!mapMode} onClick={() => onChange(false)}>
          Globe
        </button>
        <button type="button" className={styles.viewModeButton} aria-pressed={mapMode} onClick={() => onChange(true)}>
          Map
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------- zoom controls

interface ZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  canZoomIn: boolean
  canZoomOut: boolean
  /** `Globe`'s own `zoomGroupRef` — its real top edge, on desktop/tablet a few px above
   *  `ViewModeToggle`'s own (both share one row; this pill is taller), feeds
   *  `--bottom-corner-clear-top` alongside the toggle's so the sphere/map stops short of
   *  whichever of the two starts higher. */
  groupRef: RefObject<HTMLDivElement | null>
}

/** Zoom in/out — a vertical pill of two buttons, same
 *  hairline/pill idiom as `ViewModeToggle`/`Legend`'s own toggles rather than a new button
 *  language (`Globe.module.css`'s `.zoomGroup`/`.zoomButton` doc comment). Both buttons call
 *  straight into `GlobeCameraControls`'s imperative `zoomIn`/`zoomOut` (via `Globe`'s
 *  `cameraApiRef`), which dollies the *same* camera distance scroll/pinch already drives through
 *  the *same* `minDistance`/`maxDistance` clamp — never a second, parallel zoom state. Works
 *  identically in sphere and map mode (`Globe` renders this once, not per mode); `disabled`
 *  reflects `GlobeCameraControls`'s own live-reported `zoomBounds`, so a press that can't move the
 *  camera any further visibly flattens rather than doing nothing unexplained. Never hidden while
 *  the expanded view is open (project rule: nothing fades/hides on inactivity). */
function ZoomControls({ onZoomIn, onZoomOut, canZoomIn, canZoomOut, groupRef }: ZoomControlsProps) {
  return (
    <div ref={groupRef} className={styles.zoomGroup}>
      <button type="button" className={styles.zoomButton} onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in">
        <MagnifierIcon glyph="+" />
      </button>
      <div className={styles.zoomDivider} aria-hidden="true" />
      <button type="button" className={styles.zoomButton} onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out">
        <MagnifierIcon glyph="−" />
      </button>
    </div>
  )
}

/** A magnifying-glass glyph with a `+`/`−` mark, matching `.expandGlyph`'s own stroke-based,
 *  `currentColor` SVG style (`Globe.tsx`'s expand-affordance glyph) rather than a filled icon
 *  font, so it inherits `.zoomButton`'s colour/hover/disabled treatment for free. */
function MagnifierIcon({ glyph }: { glyph: '+' | '−' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.3" y1="15.3" x2="21" y2="21" />
      {glyph === '+' ? (
        <>
          <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
          <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
        </>
      ) : (
        <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      )}
    </svg>
  )
}

// --------------------------------------------------------------------------------- camera

interface GlobeCameraControlsProps {
  expanded: boolean
  mapMode: boolean
  /** 0 (sphere) .. 1 (map) — the same tween driving `GlobeSphere`'s `uUnfold`. */
  unfold: number
  /** The live-measured `.orbFitFrameSphere`/`.orbFitFrameMap` rectangles and the pixel shift to
   *  re-centre on them — `null`/`0` before the first `ResizeObserver` pass. See this component's
   *  own doc comment for how they're used. */
  sphereFit: FitFrameSize | null
  mapFit: FitFrameSize | null
  centerOffsetPx: { x: number; y: number }
  /** Reported every time the zoom-button bounds could have changed (`ZoomBounds`'s own doc
   *  comment) — mirrors `onCaptionChange`'s "cross the Canvas/DOM boundary via a callback" shape. */
  onZoomBoundsChange: (bounds: ZoomBounds) => void
  /** The sphere's rotation at `unfold = 0` (`GlobeRotatingGroup`), read to find which point of
   *  the globe the camera faces. */
  sphereRotationYRef: MutableRefObject<number>
}

/**
 * Owns `OrbitControls` for both globe states. Sphere mode is rotate plus zoom while expanded, no
 * pan. Map mode disables rotate (there is no "up" to spin
 * toward on a flat map), enables pan, and clamps both so the map can never be zoomed out past
 * its own fit-to-panel framing or panned off-screen (`camera.ts`'s `fitDistance`/
 * `clampPanTarget`).
 *
 * **The sphere itself is also fit to the panel, not just the map.** `Globe.tsx`'s minimised and
 * expanded views share one `<Canvas>`/camera object, so a plain expand (no map mode involved)
 * needs its own reframe or the camera stays at whatever pose the *minimised* orb had.
 * `idleSphereDistance`/`wasExpandedRef` below fix this the same way entering/leaving map mode
 * already re-triggers `mapFit`: a plain expand/collapse reframes to `sphereFitDistance`
 * (tight, `SPHERE_FIT_MARGIN`) or back to `CAMERA_DISTANCE` (loose, halo-friendly) respectively.
 *
 * **One view across the sphere <-> map morph.** Switching mode carries the view rather than
 * resetting it: the point at the centre of the view, and the zoom as a ratio of each mode's own
 * default framing (`SphereMapView`). Zoomed in on India on the sphere, the map opens zoomed in on
 * India by the same amount; folding back returns there. While `unfold` is between its ends, every
 * frame places the camera with `camera.ts`'s `unfoldCameraPose` — a pure function of `unfold`, so
 * a toggle reversed mid-morph runs back along the same path — and on the frame it settles, lands
 * on that function's own end pose exactly. Once settled, it stops touching `camera.position`:
 * `OrbitControls` (bounded by `minDistance`/`maxDistance` below, and by `onChange`'s pan clamp)
 * owns the camera outright, so a viewer's own zoom/pan is never fought. A resize while settled
 * updates the zoom bounds but does not reframe.
 *
 * The end the morph left is kept exactly as measured, so its first frame never jumps; the end it
 * is heading to is derived each frame from the carried zoom and focus against this render's own
 * fit distances. That matters because the panel's CSS box snaps to its new size and aspect the
 * instant `data-map-mode` changes (`Globe.module.css`), before the mesh has moved.
 *
 * Opening the map and folding straight back, without panning or zooming it, returns the sphere to
 * the exact view it left (`sphereReturnRef`). Deriving it from the map instead would lose any
 * sphere zoom the map cannot show — zoomed out past the default, or a focus the map's pan clamp
 * pulls to the centre at the default zoom.
 *
 * **Both distances are measured from the map plane, not from the origin.** `unfoldedPosition`'s
 * curvature unroll (`projection.ts`'s own doc comment) places the *fully* flattened map at
 * `z = GLOBE_RADIUS`, not `z = 0` — the tangent point the whole sheet unrolls around never moves.
 * `controls.target` stays at `(pan, pan, 0)` throughout, exactly as it always has (changing it
 * would also change how sphere-mode orbiting feels, which this feature must not touch), so
 * `fitDistance`'s own output — a distance *to the plane* — needs `GLOBE_RADIUS` added before it's
 * a valid camera-to-*target* distance. Forgetting this offset would under-back the camera by
 * exactly `GLOBE_RADIUS` at every map-mode framing (`mapFit`, and the settled-mode
 * `minDistance`/`maxDistance` zoom bounds below) — small next to the map's own ~2.7-unit
 * half-width, but a real, constant mis-framing, not a rounding error.
 *
 * **`enableDamping={settled}` below.** `drei`'s own `<OrbitControls>` wrapper defaults
 * `enableDamping` to `true` (three.js's own raw `OrbitControls` defaults it to `false` — the two
 * differ here). With damping on, a rotate/pan/zoom that was still decelerating persists a
 * fraction of its own delta into
 * later frames (`sphericalDelta`/`panOffset`, gradually decayed by `update()` rather than fully
 * drained each call) — exactly the frames this component is also driving directly via
 * `camera.position.set(...)` above, so the two would fight for the tween's first several frames.
 * Disabling damping for precisely the tween's own span (`!settled`) makes `update()` fully drain
 * that delta on its very next call instead of decaying it, leaving nothing to fight; damping
 * resumes once settled, for the ordinary smooth-drag feel a viewer gets outside the tween.
 *
 * **`sphereFit`/`mapFit`/`centerOffsetPx` (docs/GLOBE.md).** `Globe.tsx`'s `<Canvas>` fills the
 * whole backdrop (`Globe.module.css`'s `.orbExpanded` doc comment) instead of a chrome-gap-sized
 * box, so a zoomed-in sphere has room to grow past the old square clip — but the *default*,
 * un-zoomed framing must still look the size it did in that smaller box. These three props
 * (`Globe.tsx`'s own DOM-layer measurement of two
 * invisible reference rectangles) let `idleSphereDistance`/`mapFit` below fit against that
 * rectangle instead of the canvas's own now-much-larger one, and a `camera.setViewOffset` re-
 * centres the render on it — see `idleSphereDistance`'s own comment and the `setViewOffset` effect
 * for the maths. Everything else in this component (the pan clamp, the mid-morph mesh fit, the
 * cursor's pan-room check) keeps reasoning about the *real* canvas frustum
 * (`aspect`/`fovYRadians`, unchanged) — only the idle target distances are special-cased.
 *
 * **The imperative `zoomIn`/`zoomOut` handle.** `ZoomControls` (`Globe.tsx`) is
 * plain DOM, outside this react-three-fiber tree, so it can't touch `camera`/`controlsRef`
 * directly — `useImperativeHandle` below exposes exactly two methods, each going through the same
 * `zoomMinDistance`/`zoomMaxDistance` clamp `OrbitControls`' own scroll/pinch zoom already uses,
 * so the two input paths can never disagree. `onZoomBoundsChange` reports whether either button
 * would currently do anything, the same "cross the Canvas/DOM boundary via a callback" shape
 * `onCaptionChange` already uses for the caption text.
 */
const GlobeCameraControls = forwardRef<GlobeCameraApi, GlobeCameraControlsProps>(function GlobeCameraControls(
  { expanded, mapMode, unfold, sphereFit: sphereFitFrame, mapFit: mapFitFrame, centerOffsetPx, onZoomBoundsChange, sphereRotationYRef },
  ref,
) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null)
  const { camera, gl, size } = useThree()

  const aspect = size.width / size.height
  const fovYRadians = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov)

  // **The default (settled, idle) sphere/map framing fits against the measured
  // `.orbFitFrameSphere`/`.orbFitFrameMap` rectangle, not the canvas's own (now much larger —
  // `Globe.module.css`'s `.orbExpanded` doc comment) `aspect`/`fovYRadians` above.** `subFrameFovY`
  // (`camera.ts`) treats that smaller rectangle as if it were the camera's *whole* frustum at the
  // same distance, so `sphereFitDistance`/`fitDistance` below compute the distance that makes the
  // object fill *that* rectangle — the exact size it filled back when the canvas *was* that
  // rectangle — while `aspect`/`fovYRadians` above (unchanged) keep governing everything that
  // must still reason about the *real*, full-canvas frustum: the pan clamp, the mid-morph mesh
  // fit, and the cursor's pan-room check, all further down. Falls back to the
  // real canvas aspect/FOV when a frame hasn't been measured yet (`null`, before the first
  // `ResizeObserver` pass in `Globe.tsx`) — a one-frame full-size fallback is preferable to a
  // divide-by-zero or NaN distance.
  //
  // **`isSubFrameOf` also rejects a frame bigger than the canvas it's supposedly a sub-region
  // of.** `Globe.tsx`'s DOM measurement (`sphereFitFrame`) and r3f's own canvas measurement
  // (`size`, from `useThree()`) update on two *independent* `ResizeObserver`s, so there is no
  // guarantee they catch up in the same render: on the first render(s) after `expanded` flips
  // true, `sphereFitFrame` can already report the correct ~570px box while `size` still reports
  // the *minimised* orb's old, much smaller canvas dimensions (r3f hasn't re-measured `.orbExpanded`'s
  // now-full-viewport box yet). `subFrameFovY` has no way to tell a genuinely-smaller sub-frame
  // apart from this transient inconsistency — fed a `subHeightPx` larger than `canvasHeightPx`, it
  // computes an effective FOV *wider* than the real camera's own, which `sphereFitDistance` then
  // answers with a camera far too close. `canReframeSphere` below reuses this same check so that
  // one-shot "reframe on this transition" logic also waits out this window rather than consuming
  // it with a bogus distance it can never revisit.
  const sphereFrameReady = isSubFrameOf(sphereFitFrame, size)
  const mapFrameReady = isSubFrameOf(mapFitFrame, size)
  const sphereFrameAspect = sphereFrameReady && sphereFitFrame !== null ? sphereFitFrame.width / sphereFitFrame.height : aspect
  const sphereFovY = sphereFrameReady && sphereFitFrame !== null ? subFrameFovY(fovYRadians, sphereFitFrame.height, size.height) : fovYRadians
  const mapFrameAspect = mapFrameReady && mapFitFrame !== null ? mapFitFrame.width / mapFitFrame.height : aspect
  const mapFovY = mapFrameReady && mapFitFrame !== null ? subFrameFovY(fovYRadians, mapFitFrame.height, size.height) : fovYRadians

  const mapFit = fitDistance(MAP_HALF_WIDTH, MAP_HALF_HEIGHT, mapFrameAspect, mapFovY, MAP_FIT_MARGIN) + GLOBE_RADIUS
  // The sphere's own idle framing: `CAMERA_DISTANCE`'s loose, halo-friendly fit while minimised,
  // a tight fill-the-panel fit (`sphereFitDistance`) once expanded — see `wasExpandedRef` below
  // for how a plain expand/collapse (no map mode involved) re-triggers this the same way
  // entering/leaving map mode already re-triggers `mapFit`. Divided by `SPHERE_DEFAULT_SCALE`
  // (that constant's own doc comment): a smaller distance is a closer camera, so dividing (not
  // multiplying) is what makes the default sphere "slightly larger."
  const idleSphereDistance = expanded
    ? sphereFitDistance(GLOBE_RADIUS, sphereFrameAspect, sphereFovY, SPHERE_FIT_MARGIN) / SPHERE_DEFAULT_SCALE
    : CAMERA_DISTANCE
  const settled = unfold === (mapMode ? 1 : 0)

  // Re-centres the rendered sphere/map on the fit frame's own centre rather than the full
  // canvas's, as a lens-shift `setViewOffset` rather than a camera-position offset: a
  // `controls.target` off the sphere's true centre would make the sphere wobble across the screen
  // while orbiting, whereas shifting the *projection* applies the same screen shift at every
  // rotation and zoom. Sign: three.js's `updateProjectionMatrix` computes
  // `left += offsetX * width / fullWidth` and `top -= offsetY * height / fullHeight`, which puts
  // the world origin at `canvasCentre - offset` on both axes — so a shift of `centerOffsetPx`
  // (`camera.ts`'s sign convention) needs both components negated. `fullWidth`/`fullHeight` equal
  // to the canvas's own size make this a pure shift, not a crop. Cleared whenever minimised:
  // `camera`/`gl` are shared between the minimised and expanded views, so a stale offset would
  // otherwise skew the small orb too.
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    if (!expanded || size.width <= 0 || size.height <= 0) {
      perspectiveCamera.clearViewOffset()
      return
    }
    perspectiveCamera.setViewOffset(size.width, size.height, -centerOffsetPx.x, -centerOffsetPx.y, size.width, size.height)
  }, [camera, expanded, size.width, size.height, centerOffsetPx.x, centerOffsetPx.y])

  const wasSettledRef = useRef(settled)
  const viewRef = useRef<SphereMapView>(DEFAULT_SPHERE_MAP_VIEW)
  /** Whether the viewer has panned or zoomed since the map opened. Until they do, folding back
   *  returns the sphere to exactly the view it left rather than one re-derived from the map. */
  const mapAdjustedRef = useRef(false)
  const sphereReturnRef = useRef<{ focus: GlobeEffectAnchor; zoom: number } | null>(null)
  // Tracks `expanded` itself, the same "did the target I settle on just change" pattern
  // `wasSettledRef` uses for `mapMode` — see the block below for why a plain expand/collapse
  // needs its own reframe trigger distinct from the map-mode one.
  const wasExpandedRef = useRef(expanded)

  const snapPendingRef = useRef(false)
  const frameSnapPendingRef = useRef(false)
  /** The expanded sphere's idle distance the camera was last put at, while the viewer has not
   *  zoomed away from it since; `null` otherwise. The fit frame can settle a few renders after the
   *  first real measurement (the landscape layout's frame depends on chrome that only takes its
   *  expanded place once the globe opens), and an untouched camera follows it there. */
  const followedIdleDistanceRef = useRef<number | null>(null)

  if (settled !== wasSettledRef.current) {
    wasSettledRef.current = settled
    if (settled) {
      snapPendingRef.current = true
    } else {
      const controls = controlsRef.current
      const target = controls?.target ?? new THREE.Vector3()
      const height = Math.max(MIN_SURFACE_HEIGHT, camera.position.distanceTo(target) - GLOBE_RADIUS)
      if (mapMode) {
        const focus = sphereViewFocus([camera.position.x, camera.position.y, camera.position.z], sphereRotationYRef.current)
        const zoom = zoomRatio(idleSphereDistance, height + GLOBE_RADIUS)
        sphereReturnRef.current = { focus, zoom }
        mapAdjustedRef.current = false
        viewRef.current = { focus, departed: 'sphere', departedHeight: height, departedMapTarget: [0, 0], sphereZoom: zoom, mapZoom: zoom }
      } else {
        const mapZoom = zoomRatio(mapFit, height + GLOBE_RADIUS)
        const sphereReturn = mapAdjustedRef.current ? null : sphereReturnRef.current
        viewRef.current = {
          focus: sphereReturn?.focus ?? mapToLonLat(target.x, target.y, GLOBE_RADIUS),
          departed: 'map',
          departedHeight: height,
          departedMapTarget: [target.x, target.y],
          sphereZoom: sphereReturn?.zoom ?? mapZoom,
          mapZoom,
        }
      }
    }
  }

  // A plain expand/collapse (map mode untouched, `unfold` staying at 0 throughout) never flips
  // `settled` above, so it would otherwise never reframe the camera at all — the sphere would
  // simply keep whatever pose the *previous* state left it at, since `Globe.tsx`'s minimised and
  // expanded views share one `<Canvas>` (and so one camera object). Mirrors `wasSettledRef`'s own
  // "snap once, on the frame the target changes" shape, scoped to `!mapMode` — entering/leaving
  // map mode already owns the camera fully during and after its own tween, so this must never
  // also fire mid-toggle. Also resets the idle sphere distance a viewer may have zoomed away
  // from: collapsing back to the minimised orb should never leave it stuck at whatever zoom level
  // the expanded sphere was left at.
  //
  // **Waits for a real `sphereFitFrame` measurement before consuming an *expanding* transition.**
  // `Globe.tsx` can only measure `.orbFitFrameSphere`'s real rectangle once it has actually
  // mounted, which — like any DOM effect — happens one or more renders *after* the very first
  // render where `expanded` flips true; that first render still sees `sphereFitFrame === null`
  // and so falls back to fitting the *whole canvas* (`idleSphereDistance`'s own comment above).
  // Snapping to that fallback distance immediately would work exactly once, on the frame the
  // transition happened, and this same `if` is only entered again on the *next* `expanded`
  // transition — so a viewer opening the expanded globe would see it balloon to fill the entire
  // viewport and stay there permanently once the real, tight measurement arrived a frame later,
  // since nothing would ever re-trigger a reframe after this ref had already been marked
  // consumed. Only advancing `wasExpandedRef` once a real measurement exists (never gating the
  // *collapsing* direction, which needs no measurement at all — `CAMERA_DISTANCE` is a constant)
  // means this block simply tries again on every subsequent render until the measurement lands,
  // then snaps exactly once with the right number.
  //
  // A plain `!== null` check here isn't the whole story — two distinct ways for `sphereFitFrame`
  // to be non-null but still not trustworthy, both folded into `sphereFrameReady` above:
  // - `Globe.tsx`'s own measurement effect could store a real-but-degenerate `{width: 0,
  //   height: 0}` rect on the one paint before its ancestor's `--chrome-gap-height` custom
  //   property resolved — fixed at the source (that effect only ever stores a real,
  //   non-degenerate rect, so `null` already means "not ready" here without this needing to know
  //   why a rect was untrustworthy).
  // - Even a correctly-measured, real-sized `sphereFitFrame` could arrive *before* `size` (r3f's
  //   own, independently-updating canvas measurement) had caught up from the minimised orb's old,
  //   much smaller canvas — `isSubFrameOf`'s own doc comment above has the full story.
  const canReframeSphere = !expanded || sphereFrameReady
  if (!mapMode && canReframeSphere && expanded !== wasExpandedRef.current) {
    wasExpandedRef.current = expanded
    sphereReturnRef.current = null
    viewRef.current = { ...viewRef.current, sphereZoom: 1 }
    if (settled) frameSnapPendingRef.current = true
  }

  /** Both ends of the sphere <-> map morph for this frame. The end the camera left is the pose it
   *  was measured at; the end it is heading to is derived from the carried zoom and focus against
   *  this render's own fit distances, so a resize mid-morph still lands on a correct framing. */
  const unfoldViewEnds = (): UnfoldViewEnds => {
    const view = viewRef.current
    const sphereHeight =
      view.departed === 'sphere' ? view.departedHeight : Math.max(MIN_SURFACE_HEIGHT, idleSphereDistance / view.sphereZoom - GLOBE_RADIUS)
    const mapMaxHeight = mapFit - GLOBE_RADIUS
    const mapMinHeight = Math.max(MIN_SURFACE_HEIGHT, mapFit * MAP_MIN_ZOOM_FRACTION - GLOBE_RADIUS)
    const mapHeight =
      view.departed === 'map' ? view.departedHeight : Math.min(mapMaxHeight, Math.max(mapMinHeight, mapFit / view.mapZoom - GLOBE_RADIUS))
    const [focusX, focusY] = lonLatToMap(view.focus, GLOBE_RADIUS)
    const mapTarget =
      view.departed === 'map'
        ? view.departedMapTarget
        : clampPanTarget([focusX, focusY], mapHeight, aspect, fovYRadians, MAP_HALF_WIDTH, MAP_HALF_HEIGHT)
    return {
      focus: view.focus,
      globeRotationY: sphereRotationYRef.current,
      radius: GLOBE_RADIUS,
      sphereHeight,
      mapHeight,
      mapTarget,
      meshFitHeight: (u) =>
        fitDistance(unrolledHalfWidth(u, GLOBE_RADIUS), unrolledHalfHeight(u, GLOBE_RADIUS), aspect, fovYRadians, MAP_FIT_MARGIN),
    }
  }

  useFrame(() => {
    const controls = controlsRef.current
    if (controls === null) return
    // Live, every frame: `idleSphereDistance` (this render's idle/unzoomed distance for whichever
    // of minimised or expanded is on screen) is the anchor `sphereRotateSpeedForDistance` scales
    // against, so a drag keeps tracking the surface 1:1 as the viewer's own zoom moves the camera
    // away from it — captured once per drag would leave the old distance-independent runaway
    // feel for the rest of a zoom-then-rotate gesture.
    controls.rotateSpeed = sphereRotateSpeedForDistance(
      controls.target.distanceTo(camera.position),
      GLOBE_RADIUS,
      idleSphereDistance,
      DEFAULT_ROTATE_SPEED,
    )
    const applyPose = (position: readonly [number, number, number], target: readonly [number, number, number]): void => {
      controls.target.set(target[0], target[1], target[2])
      camera.position.set(position[0], position[1], position[2])
      controls.update()
    }
    if (settled) {
      // The morph's own last driven frame always runs one tick short of its end (the frame where
      // `unfold` reaches it is already settled), and under `prefers-reduced-motion` there is no
      // morph at all — `unfold` snaps. Landing on the exact end pose once, on the frame it
      // settles, covers both.
      if (frameSnapPendingRef.current) {
        frameSnapPendingRef.current = false
        snapPendingRef.current = false
        applyPose([0, 0, idleSphereDistance], [0, 0, 0])
        followedIdleDistanceRef.current = expanded && !mapMode ? idleSphereDistance : null
        return
      }
      const followed = followedIdleDistanceRef.current
      if (followed !== null && (!expanded || mapMode)) {
        followedIdleDistanceRef.current = null
      } else if (followed !== null && sphereFrameReady && Math.abs(idleSphereDistance - followed) > followed * 1e-4) {
        const offset = camera.position.clone().sub(controls.target)
        if (Math.abs(offset.length() - followed) <= followed * 1e-3) {
          offset.setLength(idleSphereDistance)
          camera.position.copy(controls.target).add(offset)
          controls.update()
          followedIdleDistanceRef.current = idleSphereDistance
        } else {
          followedIdleDistanceRef.current = null
        }
      }
      if (!snapPendingRef.current) return
      snapPendingRef.current = false
      const { position, target } = unfoldCameraPose(mapMode ? 1 : 0, unfoldViewEnds())
      applyPose(position, target)
      return
    }
    const { position, target } = unfoldCameraPose(unfold, unfoldViewEnds())
    applyPose(position, target)
  })

  // Shared by the `OrbitControls` props below, `zoomBy` and `reportZoomBounds` — one definition
  // of "how far can this mode's zoom go" that scroll/pinch, the zoom buttons and their own
  // disabled state can never disagree about.
  const zoomMinDistance = mapMode ? mapFit * MAP_MIN_ZOOM_FRACTION : 0
  const zoomMaxDistance = mapMode ? mapFit : Infinity

  /** Panning is enabled in map mode (`camera.ts`'s `mapHasPanRoom`), but has zero range at the
   *  settled default view (`mapFit`'s own margin already shows slightly *more* than the whole
   *  map), so `grab` would be misleading there. Written directly onto the canvas element's own
   *  `style.cursor` (bypassing React state/CSS class churn on every zoom tick, the same
   *  non-reactive-DOM-write discipline
   *  `setPoleLabelOpacity`/`--overlay-clear-bottom` already use elsewhere in this feature) —
   *  `Globe.module.css`'s `.orbExpanded[data-map-mode='true']` supplies the `default` resting
   *  value this clears back to. Sphere mode is untouched (`''`, inherits `.orbExpanded`'s own
   *  unconditional `grab` — rotate is always meaningful there). */
  const updateCursor = (): void => {
    if (!mapMode) {
      gl.domElement.style.cursor = ''
      return
    }
    const controls = controlsRef.current
    if (controls === null) return
    const distance = controls.target.distanceTo(camera.position)
    gl.domElement.style.cursor = mapHasPanRoom(distance, aspect, fovYRadians, MAP_HALF_WIDTH, MAP_HALF_HEIGHT) ? 'grab' : ''
  }

  /** Reports whether the zoom buttons (`ZoomControls`) can still do anything —
   *  `ZOOM_BOUNDS_EPSILON` absorbs float roundoff right at a bound rather than reading as
   *  perpetually "one step left" there. `zoomMaxDistance === Infinity` (sphere mode, today's
   *  actual, pre-existing bound — not tightened by this feature) never disables zoom-out.
   *
   *  `onZoomBoundsChange` is a React state update, so it re-renders `Globe` and its whole subtree,
   *  and `onControlsChange` fires on essentially every frame the camera moves. Since
   *  `canZoomIn`/`canZoomOut` only flip right at a zoom limit, `lastReportedZoomBoundsRef` skips
   *  the call when the answer is unchanged — nearly always, mid-gesture — which is the difference
   *  between a pinch dropping frames and one that doesn't. */
  const lastReportedZoomBoundsRef = useRef<ZoomBounds | null>(null)
  const reportZoomBounds = (): void => {
    const controls = controlsRef.current
    if (controls === null) return
    const distance = controls.target.distanceTo(camera.position)
    const bounds: ZoomBounds = {
      canZoomIn: distance > zoomMinDistance + ZOOM_BOUNDS_EPSILON,
      canZoomOut: zoomMaxDistance === Infinity ? true : distance < zoomMaxDistance - ZOOM_BOUNDS_EPSILON,
    }
    const last = lastReportedZoomBoundsRef.current
    if (last !== null && last.canZoomIn === bounds.canZoomIn && last.canZoomOut === bounds.canZoomOut) return
    lastReportedZoomBoundsRef.current = bounds
    onZoomBoundsChange(bounds)
  }

  const onControlsChange = (): void => {
    const controls = controlsRef.current
    if (controls !== null && mapMode) {
      // `controls.target` sits at the same `z = 0` it always has (see this component's own doc
      // comment on why); the flattened map itself sits `GLOBE_RADIUS` closer to the camera, at
      // `z = GLOBE_RADIUS`. Subtracting it here recovers the true camera-to-plane distance
      // `clampPanTarget`'s own FOV math needs — without it, every pan-visible-extent calculation
      // would read as `GLOBE_RADIUS` further away than the plane actually is, letting a viewer
      // pan slightly past the map's true edge.
      const planeDistance = camera.position.distanceTo(controls.target) - GLOBE_RADIUS
      const [x, y] = clampPanTarget([controls.target.x, controls.target.y], planeDistance, aspect, fovYRadians, MAP_HALF_WIDTH, MAP_HALF_HEIGHT)
      if (x !== controls.target.x || y !== controls.target.y) {
        camera.position.x += x - controls.target.x
        camera.position.y += y - controls.target.y
        controls.target.set(x, y, 0)
        // No `controls.update()` here: this function is itself the 'change' listener, so calling
        // `update()` re-enters it synchronously. With damping on, a pinch's decaying `panOffset`
        // leaves the corrected target out of bounds again on re-entry, clamping and recursing
        // until the stack overflows mid-gesture. The target set just above is what this frame
        // renders, and drei calls `update()` every frame anyway, so the next one reconciles
        // `OrbitControls`' internal bookkeeping without a recursive dispatch here.
      }
    }
    updateCursor()
    reportZoomBounds()
  }

  // Entering/leaving map mode (or a resize) changes `zoomMinDistance`/`zoomMaxDistance`/the
  // pan-room check's own geometry without necessarily firing `OrbitControls`'s own 'change' event
  // first (e.g. the very first frame after the toggle) — this keeps the cursor and the zoom
  // buttons correct even before the viewer's next drag/scroll/click does.
  useEffect(() => {
    updateCursor()
    reportZoomBounds()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `updateCursor`/`reportZoomBounds`
    // are redefined every render (they close over `controlsRef`/`camera`/`gl`, not memoized); the
    // dependency list below is deliberately just their real *inputs*, not the functions themselves.
  }, [mapMode, aspect, fovYRadians, zoomMinDistance, zoomMaxDistance])

  /** One press of `ZoomControls`' `+`/`−` — dollies `camera.position` toward or
   *  away from `controls.target` by `factor`, clamped through the exact same
   *  `zoomMinDistance`/`zoomMaxDistance` (and so `camera.ts`'s `clampedDollyDistance`) that
   *  `OrbitControls`' own `minDistance`/`maxDistance` props below already enforce for scroll/
   *  pinch — never a second, parallel notion of "how far this mode can zoom." No-op mid-tween
   *  (`!settled`): the per-frame tween above already drives `camera.position` every frame then,
   *  and would simply overwrite a manual zoom on its very next tick. */
  const zoomBy = (factor: number): void => {
    const controls = controlsRef.current
    if (controls === null || !settled) return
    const distance = controls.target.distanceTo(camera.position)
    if (distance <= 1e-6) return
    if (mapMode) mapAdjustedRef.current = true
    const nextDistance = clampedDollyDistance(distance, factor, zoomMinDistance, zoomMaxDistance)
    camera.position.sub(controls.target).multiplyScalar(nextDistance / distance).add(controls.target)
    controls.update()
    onControlsChange()
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(ZOOM_STEP_FACTOR),
    zoomOut: () => zoomBy(1 / ZOOM_STEP_FACTOR),
  }))

  return (
    <OrbitControls
      ref={controlsRef}
      enableZoom={expanded}
      enablePan={mapMode}
      enableRotate={!mapMode}
      enableDamping={settled}
      // `rotateSpeed` is driven live from camera distance in the `useFrame` above, not set here
      // (which would only fix it once, at mount) — `DEFAULT_ROTATE_SPEED`'s own doc comment.
      minDistance={zoomMinDistance}
      maxDistance={zoomMaxDistance}
      onChange={onControlsChange}
      onStart={() => {
        if (mapMode) mapAdjustedRef.current = true
      }}
      // `OrbitControls`'s own default `mouseButtons`/`touches` map the primary drag gesture (LEFT
      // click, one-finger touch) to `ROTATE`, unconditionally — `enablePan={mapMode}` above only
      // ever enables *panning itself*, it never reroutes which gesture triggers it. In map mode
      // `enableRotate` is false, so a plain left-drag hit `MOUSE.ROTATE`'s own `enableRotate ===
      // false` early return inside three.js's `onMouseDown` and did nothing at all — not "panned
      // with no room" (that would need `camera.ts`'s `mapHasPanRoom`, already correctly wired into
      // `updateCursor` below, to be false), but a plain drag never reaching `_handleMouseDownPan`
      // in the first place, at *any* zoom level. Routing the primary gesture to `PAN` whenever
      // `enablePan` is (`mapMode`) fixes that; `RIGHT`/`MIDDLE` stay at three.js's own defaults in
      // both modes (`RIGHT: PAN` is a harmless no-op in sphere mode, where `enablePan` is already
      // false) so this is the minimal change that unblocks the primary gesture, not a redesign of
      // every button's role.
      mouseButtons={{
        LEFT: mapMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{
        ONE: mapMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  )
})

// ------------------------------------------------------------------------------- rotation

interface GlobeRotatingGroupProps {
  /** 0 (sphere) .. 1 (map) — `useGlobeAutoRotationY`'s own eased-to-square-on-and-back
   *  behaviour over this same span. */
  unfold: number
  reducedMotion: boolean
  /** The current scene's location longitude (ADR-034), or `null` for none. Handed to the same
   *  accumulator that owns the drift rather than applied as a second rotation — see
   *  `useGlobeAutoRotation.ts`'s own doc comment for why the rotation itself (which also needs
   *  the camera's live azimuth) is computed inside that hook, not here. */
  focusLon: number | null
  /** See `GlobeRotationOptions.sphereRotationYRef`. */
  sphereRotationYRef: MutableRefObject<number>
  children: ReactNode
}

/**
 * The single owner of the sphere's auto-rotate transform (docs/GLOBE.md §10). `GlobeSphere` and
 * `HumanCivilisation` are rendered as *children* of this `<group>`
 * rather than independent siblings that each read a shared rotation ref in their own
 * `useFrame` — three.js composes this group's `rotation.y` into every child's world matrix
 * during the render pass itself, so there is no JS-level read-after-write ordering between
 * separate `useFrame` callbacks to get wrong (`useGlobeAutoRotationY`'s own doc comment has the
 * full story on the bug this replaces: r3f fires child `useFrame`s before their parent's, so a
 * child reading a ref the parent had only *just* written in the same frame could read last
 * frame's value, visibly lagging the sphere by however many degrees one frame's rotation is).
 *
 * `PoleAxisMarkers` deliberately stays *outside* this group (its own doc comment) — both poles
 * sit on the rotation axis itself, so spinning them is a no-op not worth the extra nesting.
 */
function GlobeRotatingGroup({ unfold, reducedMotion, focusLon, sphereRotationYRef, children }: GlobeRotatingGroupProps) {
  const groupRef = useRef<THREE.Group>(null)
  const rotationYRef = useGlobeAutoRotationY({ unfold, reducedMotion, focusLon, sphereRotationYRef })
  useFrame(() => {
    const group = groupRef.current
    if (group !== null) group.rotation.y = rotationYRef.current
  })
  return <group ref={groupRef}>{children}</group>
}

/** Which way `t` last moved, remembered across renders so preloading keeps looking ahead
 *  after playback pauses. Playback runs from the past towards the present by default. */
function useTravelDirection(t: GeoTime): TravelDirection {
  const lastRef = useRef<{ t: GeoTime; direction: TravelDirection }>({ t, direction: 'toPresent' })
  const direction = travelDirection(lastRef.current.t, t, lastRef.current.direction)
  useEffect(() => {
    lastRef.current = { t, direction }
  })
  return direction
}

/** Reports `caption` to `onCaptionChange` whenever it changes (including to `''`), so a caller
 *  that renders the caption elsewhere (the minimised orb's `ShellLayout` label slot) stays in
 *  sync without Globe drawing anything itself. A no-op when `onCaptionChange` is omitted. */
function useCaptionReport(caption: string, onCaptionChange: ((caption: string) => void) | undefined): void {
  useEffect(() => {
    onCaptionChange?.(caption)
  }, [caption, onCaptionChange])
}

/**
 * Reports `elRef`'s own real rendered height in CSS px on every change, and `0` whenever
 * `mounted` is false — `GlobeProps.onViewModeToggleHeightChange`'s own doc comment has the full
 * cross-component "why": `ShellLayout.tsx`'s `useChromeGap` needs this number to size the
 * expanded sphere/map into what's genuinely left over once the toggle's own band is reserved,
 * but has no ref into this component's internal DOM. `mounted` (rather than inferring "not
 * there" purely from `elRef.current === null`) is passed explicitly because a ref update and this
 * effect's own re-run are both driven by the same render, so reading `elRef.current` here always
 * already reflects the *current* render's mount state — the explicit boolean just makes that
 * dependency visible to the effect's own dependency array instead of silently relying on the ref
 * object's identity never changing (`useRef` always returns the same object, so a bare `[elRef]`
 * dependency would never re-run this effect at all).
 */
function useViewModeToggleHeightReport(
  elRef: RefObject<HTMLDivElement | null>,
  mounted: boolean,
  onViewModeToggleHeightChange: ((heightPx: number) => void) | undefined,
): void {
  useEffect(() => {
    const report = (heightPx: number): void => onViewModeToggleHeightChange?.(heightPx)
    const el = elRef.current
    if (!mounted || el === null) {
      report(0)
      return undefined
    }
    const recompute = (): void => report(el.getBoundingClientRect().height)
    recompute()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    return () => {
      observer.disconnect()
      report(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `elRef` is a stable `useRef` object
    // (its identity never changes, so including it would never trigger a re-run); `mounted` is
    // the real, changing input that decides whether `elRef.current` is worth observing this time.
  }, [mounted, onViewModeToggleHeightChange])
}

/**
 * The expanded canvas's own budgeted DPR (`EXPANDED_DPR_BUDGET_PIXELS`'s own doc comment) — reads
 * `window.innerWidth`/`innerHeight` directly rather than waiting on a `ResizeObserver` measurement
 * of `.orbExpanded` itself: that element is `position: absolute; inset: 0` inside a
 * `position: fixed; inset: 0` backdrop (`Globe.module.css`'s own doc comment), so it always
 * exactly matches the viewport, known synchronously on the very first render — no "not measured
 * yet" fallback state to get wrong the way `sphereFitFrame`'s own DOM measurement needs one for
 * (`sphereFrameReady`'s own doc comment has that story). Only tracked while `expanded`: the
 * minimised orb keeps `MINIMISED_DPR` unconditionally and never needs this at all. */
function useExpandedCanvasDpr(expanded: boolean): number {
  const [size, setSize] = useState<{ width: number; height: number }>(() =>
    typeof window === 'undefined' ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight },
  )
  useEffect(() => {
    if (!expanded) return undefined
    const recompute = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [expanded])
  const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return budgetedDpr(devicePixelRatio, size.width, size.height, EXPANDED_DPR_BUDGET_PIXELS)
}

/** Escape collapses the expanded globe. The latest callback is read through a ref so the
 *  listener isn't re-subscribed on every render (the globe re-renders every playback frame). */
function useCloseOnEscape(expanded: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])
}

// ------------------------------------------------------------------------------- sphere

interface GlobeSphereProps {
  beforeTex: THREE.Texture | null
  afterTex: THREE.Texture | null
  mix: number
  hasData: boolean
  /** docs/GLOBE.md G6/G8: the pre-1 Ga regime blend, ice shell and impact/giant-impact
   *  overlays resolved by `web/src/globe/effects`, in exactly the shape `shaders.ts`'s new
   *  uniforms want. */
  effects: GlobeEffectUniforms
  /** docs/GLOBE.md §5.1: the presented ice age, driving `uIceSheetRadius` and `uSeaLevel`. */
  iceAge: IceAgeState
  /** 0 (sphere) .. 1 (Equal Earth map) — `GLOBE_VERTEX_SHADER`'s `uUnfold` (docs/GLOBE.md's
   *  ADR-033). */
  unfold: number
  /** The toggle's own raw target, read by the mesh's analytic raycast below instead of `unfold`
   *  — see that raycast's own doc comment for why the two must not be conflated. */
  mapMode: boolean
  /** docs/GLOBE.md's ADR-030: the human-era basemap texture (`null` until loaded, or when
   *  no basemap layer is published) and its crossfade weight over the ordinary PaleoDEM base. */
  basemapTex: THREE.Texture | null
  basemapStrength: number
  /** The globe's single raster-overlay slot (ADR-041): which kind is bound (`overlayKindUniform`
   *  in `overlay.ts`), the two bracketing frames for whichever kind that is, the mix between
   *  them, the overlay's own fade-in weight, and the channel weights/log ceiling its sampling
   *  mode needs. `overlayStrength` is 0 whenever no overlay is selected, the layer isn't
   *  published, or `t` is outside its domain — in which case the shader term is a no-op and the
   *  placeholder textures are never sampled for anything visible. */
  overlayKind: number
  overlayBeforeTex: THREE.Texture | null
  overlayAfterTex: THREE.Texture | null
  overlayMix: number
  overlayStrength: number
  overlayChannel: readonly [number, number, number]
  overlayDMax: number
  /** The historical-empires texture pair (`empireTexture.ts`) and its crossfade; `empireStrength`
   *  is 0 while the human-civilisation layer is off or nothing is bound yet. */
  empireBeforeTex: THREE.Texture | null
  empireAfterTex: THREE.Texture | null
  empireMix: number
  empireStrength: number
  /** Called once, the moment `webglcontextrestored` fires on the
   *  renderer's canvas — see `Globe`'s own `onWebglContextRestored` doc comment for why the
   *  human-era cache needs this and the PaleoDEM one doesn't. */
  onWebglContextRestored: () => void
}

/** `uImpactFlashAnchorUv`'s value when no anchored effect is active (`effects.impactFlash` is
 *  then 0, so the shader's flash term is zeroed regardless of where this points). */
const NO_ANCHOR_UV: [number, number] = [0, 0]

function GlobeSphere({
  beforeTex,
  afterTex,
  mix,
  hasData,
  effects,
  iceAge,
  unfold,
  mapMode,
  basemapTex,
  basemapStrength,
  overlayKind,
  overlayBeforeTex,
  overlayAfterTex,
  overlayMix,
  overlayStrength,
  overlayChannel,
  overlayDMax,
  empireBeforeTex,
  empireAfterTex,
  empireMix,
  empireStrength,
  onWebglContextRestored,
}: GlobeSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  // Rebuilt only if the segment counts ever change (they don't, today) — `globeGeometry.ts`'s
  // grid needs no three.js render context, so this is cheap and safe in a plain `useMemo`.
  const geometry = useMemo(() => buildGlobeGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // `globeGeometry.ts`'s grid deliberately carries no `position` attribute — every vertex
  // is computed on the GPU from `aLonLat` (that file's own doc comment) — so three.js's default
  // `Mesh.raycast` calls `geometry.computeBoundingSphere()`, finds no `position` attribute to
  // measure, and is left with the default empty sphere (`radius = -1`); modern three.js
  // explicitly refuses to intersect that ("handle empty spheres", `Ray.intersectSphere`), so
  // *every* raycast against this mesh reports a miss, on the visible globe/map itself and not
  // just the transparent backdrop around it. `Globe.tsx`'s own `<Canvas onPointerMissed>` (below)
  // trusts that miss to mean "the click landed on the dimmed backdrop, close the view" — exactly
  // the same "no `position` attribute for a raycaster to intersect" gap `GlobeTooltip.tsx`'s own
  // doc comment already documents for the human layer's markers/arcs, worked around there with
  // screen-space hit-testing instead of three.js raycasting. This is that same fix applied to the
  // body mesh: an analytic proxy raycast, good enough to tell "on the globe" from "off it" without
  // rebuilding real per-vertex geometry every tween frame just for hit-testing — a unit sphere for
  // sphere mode, the map's own flat rectangle for map mode (`projection.ts`'s `unfoldedPosition`
  // doc comment: "the flat endpoint sits at z = radius"), rather than three.js's own broken
  // triangle-level test. Both local-space shapes are unscaled (`radius = 1`, `projection.ts`'s own
  // convention) — `mesh.matrixWorld` (read fresh on every click, including this mesh's own
  // `scale={GLOBE_RADIUS}` and the parent `GlobeRotatingGroup`'s rotation) applies the real radius
  // and orientation when the local hit point is converted back to world space.
  //
  // **A working `raycast` alone is not enough.** r3f only raycasts objects it has registered in
  // its own internal
  // candidate list, and it only registers an object there "when it has handlers"
  // (`@react-three/fiber`'s event manager: `if (instance.eventCount && object.raycast !== null)`).
  // This mesh has no JSX pointer-event prop of its own otherwise, so without one it is invisible
  // to that candidate list regardless of how correct `raycast` is — `onPointerMissed` would keep
  // reporting every click here as a miss. `NOOP_POINTER_HANDLER`'s own doc comment has the fix
  // (a no-op `onPointerOver` on the `<mesh>` below, purely to register it).
  //
  // Keyed off `mapMode` itself, not `unfold`: `unfold` is `useUnfold`'s *presented*, rate-limited
  // value, which — even snapping instantly under reduced motion — only reaches its new target
  // inside `useRateLimitedState`'s own `requestAnimationFrame` callback, one frame after the
  // toggle. `GlobeCameraControls`'s own camera-reframe bookkeeping depends on observing that one
  // lagging frame (it watches `unfold` settle, not the toggle itself), so `unfold` can't be made to
  // snap synchronously without breaking that. This mesh's own hit-test has no such dependency — it
  // only ever needs "which shape is the toggle asking for right now" — so it reads `mapMode`
  // directly through its own ref, which a plain `useState` setter already updates synchronously
  // with the click.
  const mapModeRef = useRef(mapMode)
  useEffect(() => {
    mapModeRef.current = mapMode
  })
  useEffect(() => {
    const mesh = meshRef.current
    if (mesh === null) return
    mesh.raycast = (raycaster, intersects) => {
      raycastInverseMatrix.copy(mesh.matrixWorld).invert()
      raycastLocalRay.copy(raycaster.ray).applyMatrix4(raycastInverseMatrix)
      const localHit = mapModeRef.current
        ? raycastLocalRay.intersectBox(RAYCAST_MAP_LOCAL_BOX, raycastLocalHit)
        : raycastLocalRay.intersectSphere(RAYCAST_UNIT_SPHERE, raycastLocalHit)
      if (localHit === null) return
      raycastWorldHit.copy(localHit).applyMatrix4(mesh.matrixWorld)
      intersects.push({ distance: raycaster.ray.origin.distanceTo(raycastWorldHit), point: raycastWorldHit.clone(), object: mesh })
    }
  }, [])

  // docs/GLOBE.md's ADR-030: forces the human-era basemap texture's GPU upload the
  // moment it arrives here, then closes its backing ImageBitmap (`initAndCloseHumanEraTexture`,
  // `humanEraTextureCache.ts`'s own doc comment) rather than closing it on a fixed frame-count
  // guess, which can leave the texture blank on a cold cache's first expand. `GlobeSphere` is the
  // one place in this file with `useThree()` access to the renderer; `initedRef` is a `WeakSet`
  // so a texture already handled (including the shared `PLACEHOLDER_TEXTURE`, which has no
  // `ImageBitmap` image to close anyway) is never re-initialised on a later render.
  const { gl } = useThree()

  // Reports the live renderer's own anisotropic-filtering ceiling up to the two texture caches
  // (docs/GLOBE.md §10) — `GlobeSphere` is the one place with `useThree()` access to it,
  // the same reasoning `initAndCloseHumanEraTexture` below already follows. Every texture fetched
  // after this point picks it up; sharpens oblique sampling near the sphere's limb, does little
  // for a flat, near-perpendicular view.
  useEffect(() => {
    setMaxAnisotropy(gl.capabilities.getMaxAnisotropy())
    setHumanEraMaxAnisotropy(gl.capabilities.getMaxAnisotropy())
    setEmpireMaxAnisotropy(gl.capabilities.getMaxAnisotropy())
  }, [gl])

  const initedTexturesRef = useRef<WeakSet<THREE.Texture>>(new WeakSet())
  useEffect(() => {
    // Every human-era texture (basemap tier, both overlay frames) needs the same treatment — they
    // all come from `humanEraTextureCache`, which closes their backing `ImageBitmap` the moment
    // this forced upload has happened.
    for (const texture of [basemapTex, overlayBeforeTex, overlayAfterTex, empireBeforeTex, empireAfterTex]) {
      if (texture === null || initedTexturesRef.current.has(texture)) continue
      initedTexturesRef.current.add(texture)
      initAndCloseHumanEraTexture(gl, texture)
    }
  }, [gl, basemapTex, overlayBeforeTex, overlayAfterTex, empireBeforeTex, empireAfterTex])

  // On `webglcontextrestored`, every texture this WeakSet remembers
  // having already force-uploaded is gone from the GPU regardless — clearing it lets any texture
  // that does survive (a fresh one from a just-cleared, re-fetched human-era cache) be
  // force-uploaded again rather than being silently skipped as "already handled". The latest
  // `onWebglContextRestored` is read through a ref, the same pattern `useCloseOnEscape` uses
  // above, so this effect doesn't need to re-subscribe every time `Globe` re-renders with a new
  // closure identity.
  const onWebglContextRestoredRef = useRef(onWebglContextRestored)
  useEffect(() => {
    onWebglContextRestoredRef.current = onWebglContextRestored
  })
  useEffect(() => {
    const canvas = gl.domElement
    const handleRestored = (): void => {
      initedTexturesRef.current = new WeakSet()
      onWebglContextRestoredRef.current()
    }
    canvas.addEventListener('webglcontextrestored', handleRestored)
    return () => canvas.removeEventListener('webglcontextrestored', handleRestored)
  }, [gl])
  // Wall-clock seconds, not t (shaders.ts's uTime doc comment) — drives the magma-ocean crack
  // shimmer and water-world steam drift. Auto-rotate itself is owned by the parent
  // `GlobeRotatingGroup` (its own doc comment), not this mesh — `GlobeSphere` no longer sets its
  // own `rotation.y` at all.
  const clockRef = useRef(0)

  const uniforms = useMemo(
    () => ({
      uBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uMix: { value: 0 },
      uHasData: { value: 0 },
      uRegimeWeights: { value: [0, 0, 0, 0] },
      uIceShell: { value: 0 },
      uImpactWinterVeil: { value: 0 },
      uImpactFlash: { value: 0 },
      uImpactFlashAnchorUv: { value: NO_ANCHOR_UV },
      uGiantImpactFlash: { value: 0 },
      uTime: { value: 0 },
      uUnfold: { value: 0 },
      uBasemapTex: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uBasemapStrength: { value: 0 },
      uOverlayKind: { value: 0 },
      uOverlayBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uOverlayAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uOverlayMix: { value: 0 },
      uOverlayChannel: { value: [1, 0, 0] },
      uOverlayDMax: { value: 1 },
      uOverlayStrength: { value: 0 },
      uEmpireBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uEmpireAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uEmpireMix: { value: 0 },
      uEmpireStrength: { value: 0 },
      uSeaLevel: { value: 0 },
      uIceSheetRadius: { value: new Float32Array(ICE_SHEET_DOME_COUNT) },
    }),
    [],
  )

  useEffect(() => {
    writeIceSheetRadii(iceAge, uniforms.uIceSheetRadius.value)
  }, [iceAge, uniforms])

  useFrame((_state, delta) => {
    clockRef.current += delta
    uniforms.uTime.value = clockRef.current
  })

  const { regimeWeights, impactFlashAnchorUv } = effects
  const anchorUv = impactFlashAnchorUv !== null ? [impactFlashAnchorUv.u, impactFlashAnchorUv.v] : NO_ANCHOR_UV

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      scale={GLOBE_RADIUS}
      frustumCulled={false}
      onPointerOver={NOOP_POINTER_HANDLER}
    >
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GLOBE_VERTEX_SHADER}
        fragmentShader={GLOBE_FRAGMENT_SHADER}
        uniforms-uBefore-value={beforeTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uAfter-value={afterTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uMix-value={mix}
        uniforms-uHasData-value={hasData ? 1 : 0}
        uniforms-uUnfold-value={unfold}
        uniforms-uRegimeWeights-value={[
          regimeWeights.magmaOcean,
          regimeWeights.waterWorld,
          regimeWeights.archean,
          regimeWeights.unknownGeography,
        ]}
        uniforms-uIceShell-value={effects.iceShell}
        uniforms-uImpactWinterVeil-value={effects.impactWinterVeil}
        uniforms-uImpactFlash-value={effects.impactFlash}
        uniforms-uImpactFlashAnchorUv-value={anchorUv}
        uniforms-uGiantImpactFlash-value={effects.giantImpactFlash}
        uniforms-uBasemapTex-value={basemapTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uBasemapStrength-value={basemapStrength}
        uniforms-uOverlayKind-value={overlayKind}
        uniforms-uOverlayBefore-value={overlayBeforeTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uOverlayAfter-value={overlayAfterTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uOverlayMix-value={overlayMix}
        uniforms-uOverlayChannel-value={overlayChannel}
        uniforms-uOverlayDMax-value={overlayDMax}
        uniforms-uOverlayStrength-value={overlayStrength}
        uniforms-uEmpireBefore-value={empireBeforeTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uEmpireAfter-value={empireAfterTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uEmpireMix-value={empireMix}
        uniforms-uEmpireStrength-value={empireStrength}
        uniforms-uSeaLevel-value={iceAge.seaLevelM}
      />
    </mesh>
  )
}

// --------------------------------------------------------------------------- atmosphere

interface AtmosphereRimProps {
  /** Fades the rim out as the globe unfolds (`shaders.ts`'s `RIM_FRAGMENT_SHADER` doc comment)
   *  — an atmospheric glow has no sensible reading around a flat map, so rather than morph this
   *  shell's own geometry too, it simply recedes over the same span the sphere flattens. */
  unfold: number
}

function AtmosphereRim({ unfold }: AtmosphereRimProps) {
  const uniforms = useMemo(() => ({ uColor: { value: RIM_COLOR }, uUnfold: { value: 0 } }), [])

  // `RIM_FRAGMENT_SHADER`'s own alpha term is `glow * 0.42 * (1.0 - uUnfold)` — exactly 0 in
  // full map mode. Skipping the draw call entirely there (rather than letting the GPU rasterise
  // a shell that blends in nothing) is free in sphere/mid-unfold, where this is `false`.
  if (unfold >= 1) return null

  return (
    <mesh scale={ATMOSPHERE_SCALE}>
      <sphereGeometry args={[1, 48, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={RIM_VERTEX_SHADER}
        fragmentShader={RIM_FRAGMENT_SHADER}
        uniforms-uUnfold-value={unfold}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

// -------------------------------------------------------------------------------- poles

const POLES: readonly PoleId[] = ['N', 'S']
/** `--hud-ink` (globals.css) — three.js has no way to read a CSS custom property, so the hex is
 *  kept in step with it by hand, the same precedent `RIM_COLOR` sets above. */
const POLE_STUB_COLOR = new THREE.Color('#efe9dc')
/** A hair past `GLOBE_RADIUS` rather than exactly on it, so the stub's own base vertex doesn't
 *  z-fight against the sphere surface it's meant to sit on. */
const POLE_STUB_START_RADIUS = GLOBE_RADIUS * 1.01
/** Small enough to read as a tick at the pole, not a spike competing with the atmosphere rim
 *  (`ATMOSPHERE_SCALE`, shaders.ts) or the ice-shell/impact-veil effects rendered over the
 *  sphere (docs/GLOBE.md G6). */
const POLE_STUB_END_RADIUS = GLOBE_RADIUS + 0.08
/** Just outside the atmosphere shell (`ATMOSPHERE_SCALE` = 1.15), so the label reads against
 *  the dim halo beyond it rather than fighting the rim's own bright fringe. */
const POLE_LABEL_RADIUS = GLOBE_RADIUS + 0.18

interface PoleGeometry {
  labelPosition: readonly [number, number, number]
  stub: THREE.Line
}

function buildPoleGeometry(pole: PoleId): PoleGeometry {
  const [dx, dy, dz] = poleDirection(pole)
  const stubGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(dx * POLE_STUB_START_RADIUS, dy * POLE_STUB_START_RADIUS, dz * POLE_STUB_START_RADIUS),
    new THREE.Vector3(dx * POLE_STUB_END_RADIUS, dy * POLE_STUB_END_RADIUS, dz * POLE_STUB_END_RADIUS),
  ])
  const stubMaterial = new THREE.LineBasicMaterial({ color: POLE_STUB_COLOR, transparent: true, opacity: 0.55 })
  return {
    labelPosition: [dx * POLE_LABEL_RADIUS, dy * POLE_LABEL_RADIUS, dz * POLE_LABEL_RADIUS],
    stub: new THREE.Line(stubGeometry, stubMaterial),
  }
}

/** Sets a DOM element's opacity directly, bypassing React state — the same non-reactive,
 *  per-frame-safe pattern `GlobeSphere`'s `uTime` uniform update uses above, applied here to a
 *  real DOM node instead of a GPU uniform since the label is `Html`, not shader-drawn. */
function setPoleLabelOpacity(el: HTMLElement | null, opacity: number): void {
  if (el === null) return
  el.style.opacity = String(opacity)
}

interface PoleAxisMarkersProps {
  /** 0 (sphere) .. 1 (map) — see the doc comment below for why this fades the markers out
   *  entirely rather than relocating them. */
  unfold: number
}

/**
 * Orientation cue: a short axis stub at each pole (`shaders.ts`'s uv formula puts geographic
 * north at `+Y` — see `poles.ts`'s doc comment) plus a small "N"/"S" label, so a viewer has a
 * sense of which way is up on an otherwise ambiguous rotating sphere. Not a location claim
 * (ADR-007 rules those out) — this only marks the sphere's own rotation axis, the same fact for
 * every `t`.
 *
 * The stub is real depth-tested geometry (`THREE.Line`, default `depthTest`), so the sphere's
 * own depth buffer hides it correctly when it's on the far side — no visibility logic needed.
 * The label is a DOM overlay (`Html`) and isn't depth-tested, so it needs `poles.ts`'s pure
 * `isPoleVisible`, checked every frame against the live (drag-rotated) camera and applied via
 * `setPoleLabelOpacity` rather than React state, to stay cheap at 60fps. Both poles sit at a
 * fixed world position regardless of the sphere's own auto-rotate (`poles.ts`'s doc comment on
 * why), so neither the stub nor the label needs to track `GlobeSphere`'s `mesh.rotation.y`.
 *
 * **Map mode (docs/GLOBE.md's ADR-033).** Both the stub (fixed 3D geometry, unrelated to
 * `GlobeSphere`'s morphing mesh) and the label (positioned from the same fixed `poleDirection`)
 * stay anchored to the *sphere's* pole position regardless of `unfold` — they are not projected
 * through `projection.ts`. That is deliberate, not an oversight: Equal Earth flattens each pole
 * to a *line* spanning the map's own top/bottom edge, not a point (see `projection.ts`'s own doc
 * comment on `EQUAL_EARTH_HALF_HEIGHT`), so there is no single correct map-mode position for a
 * point marker to relocate to — an edge label naming the whole top/bottom edge was the other
 * option considered, but a static "N"/"S" caption spanning the map's curved top and bottom
 * edges would need its own layout logic for comparatively little payoff, since the map's overall
 * shape (curving to a point-like top and bottom) already reads as "up is north" without one.
 * Simplest and most honest: both fade out together with the sphere as `unfold` rises (the same
 * motion already carrying the rest of the mesh) rather than popping or drifting to a wrong place,
 * and fade back in as it folds.
 */
function PoleAxisMarkers({ unfold }: PoleAxisMarkersProps) {
  const { camera } = useThree()
  const labelRefs = useRef<Record<PoleId, HTMLSpanElement | null>>({ N: null, S: null })

  const poleGeometry = useMemo<Record<PoleId, PoleGeometry>>(
    () => ({ N: buildPoleGeometry('N'), S: buildPoleGeometry('S') }),
    [],
  )
  useEffect(
    () => () => {
      for (const pole of POLES) {
        poleGeometry[pole].stub.geometry.dispose()
        ;(poleGeometry[pole].stub.material as THREE.Material).dispose()
      }
    },
    [poleGeometry],
  )

  useFrame(() => {
    const cameraPosition: readonly [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
    const unfoldOpacity = 1 - unfold
    for (const pole of POLES) {
      const visible = isPoleVisible(pole, cameraPosition, GLOBE_RADIUS)
      setPoleLabelOpacity(labelRefs.current[pole], visible ? unfoldOpacity : 0)
      const stubMaterial = poleGeometry[pole].stub.material as THREE.LineBasicMaterial
      stubMaterial.opacity = 0.55 * unfoldOpacity
    }
  })

  return (
    <>
      {POLES.map((pole) => (
        <group key={pole}>
          <primitive object={poleGeometry[pole].stub} />
          <Html position={poleGeometry[pole].labelPosition} center pointerEvents="none">
            <span
              ref={(el) => {
                labelRefs.current[pole] = el
              }}
              className={styles.poleLabel}
            >
              {pole}
            </span>
          </Html>
        </group>
      ))}
    </>
  )
}
