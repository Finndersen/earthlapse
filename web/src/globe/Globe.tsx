'use client'

/**
 * The globe view (DESIGN §7). A three.js sphere, independent of the scene view, driven only
 * by `t`. See `index.ts` for the props contract.
 */

import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import * as THREE from 'three'

import { useReducedMotion } from '@/lib/useReducedMotion'
import { probeWebgl } from '@/lib/webgl'
import type { FeatureData, GeoTime, TimelineEvent } from '@/types/layer'
import type { SceneLocation } from '@/types/manifest'

import { arrivalTimingFor, hasVisibleArrivals } from './arcs'
import { citiesHaveDataAt } from './cities'
import { densityBlendAt, densityChannelMask, densityHasDataAt, densityStrengthAt } from './density'
import { DensityRampKey } from './DensityRampKey'
import { HumanCivilisation } from './HumanCivilisation'
import { sceneMarkerCoordinates, focusRotationY } from './sceneLocation'
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
  type GlobeRasterLayers,
  type PreloadWindow,
  type TravelDirection,
} from './blend'
import {
  budgetedDpr,
  clampedDollyDistance,
  clampPanTarget,
  fitDistance,
  isSubFrameOf,
  mapHasPanRoom,
  slerpDirection,
  sphereFitDistance,
  subFrameFovY,
  verticalCenterOffset,
} from './camera'
import { selectBasemapTier, supportsBasemapT1, useIsPhoneViewport } from './deviceTier'
import { useGlobeEffects, type GlobeEffectUniforms } from './effects'
import styles from './Globe.module.css'
import { buildGlobeGeometry } from './globeGeometry'
import { GlobeStaticOrb } from './GlobeStaticOrb'
import { basemapTextureCache, densityTextureCache, initAndCloseHumanEraTexture } from './humanEraTextureCache'
import { Legend, type LegendRow } from './Legend'
import { isOrbClick } from './orbGesture'
import { isPoleVisible, poleDirection, type PoleId } from './poles'
import { EQUAL_EARTH_HALF_HEIGHT, EQUAL_EARTH_HALF_WIDTH, unrolledHalfHeight, unrolledHalfWidth } from './projection'
import {
  ATMOSPHERE_SCALE,
  GLOBE_FRAGMENT_SHADER,
  GLOBE_VERTEX_SHADER,
  RIM_FRAGMENT_SHADER,
  RIM_VERTEX_SHADER,
} from './shaders'
import { PLACEHOLDER_TEXTURE } from './textureCache'
import { useGlobeAutoRotationY } from './useGlobeAutoRotation'
import { useGlobeTexturePair } from './useGlobeTexturePair'
import { useUnfold } from './unfoldAnimation'

const RIM_COLOR = new THREE.Color('#8fc7ff')
/** Far enough back (with the 40° fov) that the sphere and its atmosphere shell sit whole
 *  inside the canvas with a margin — the orb reads as a floating object, never a disc
 *  clipped square. The planet's silhouette lands at ≈76% of the canvas half-size, which
 *  Globe.module.css's halo and expand ring are sized against. */
const CAMERA_DISTANCE = 3.6
/** The minimised orb's own device-pixel-ratio range — small canvas, so retina sharpness is cheap.
 *  Unchanged from before this file's full-bleed-canvas change (issue 1). */
const MINIMISED_DPR: [number, number] = [1, 2]
/**
 * The pixel budget `budgetedDpr` (`camera.ts`) sizes the *expanded* canvas's device pixel ratio
 * against — a measured trade-off for the "responsive dragging" follow-up (user verbatim: "the
 * click-dragging of the globe in expanded view doesn't feel very responsive... not sure if this
 * is a 'weight'/friction setting or a performance issue"), revised after a first pass pinned this
 * to a flat `1` and was asked to be re-measured and replaced.
 *
 * **The diagnosis, unchanged across both passes.** Input tuning (`rotateSpeed`/`dampingFactor`)
 * was not the cause — idle (no interaction at all) render pace dropped by the same amount as
 * during a drag, which a damping/speed setting cannot explain. Frame rate was it, and it *was*
 * newly caused by issue 1's canvas covering the whole backdrop instead of a ~550px box.
 *
 * **The magnitude, re-measured on a quiet machine.** The first pass's ~13x figure at
 * `deviceScaleFactor: 2` was measured while the test machine was also on a video call — a real
 * confound neither the earlier pass nor the headless/software-rasteriser caveat it carried
 * accounted for. Re-measured with the same method (a `git worktree` checkout of the pre-clip-
 * removal commit as the "before" build, alternating trials against the current build, `--port
 * 4322 --out globe-frame`) on an otherwise-idle machine: at 1440x900 with `deviceScaleFactor: 2`
 * the regression was ~1.6x (idle fps 7.34 -> 4.57 across five alternating trials each), not ~13x;
 * at `deviceScaleFactor: 1` the area increase alone cost ~1.3x (18.04 -> 13.50), matching the
 * first pass's own DPR-1 figure closely. A third data point at a larger buffer (1728x1117 @
 * `deviceScaleFactor: 2`, ~7.72M px, approximating a 16" MacBook Pro) measured 3.05 fps — cost
 * scales roughly linearly with pixel count *once past* ~5M px, not the sharply superlinear curve
 * the confounded figure implied.
 *
 * **Why a budget instead of reinstating the flat pin.** A flat `dpr = 1` has a flaw independent
 * of whichever figure justified it: it bounds nothing. It's needlessly soft on a small buffer (an
 * ordinary laptop's expanded view has real headroom the measurements above confirm) and still
 * unbounded on a large one (a 5K display's own ~14M-px buffer at `dpr: 1` is considerably worse
 * than the ~5.2M-px case a pin was introduced to fix, since a flat pin never looks at how big the
 * canvas actually is). `EXPANDED_DPR_BUDGET_PIXELS` bounds the *buffer* itself, so it holds at any
 * display size instead of only the one it happened to be tuned against.
 *
 * **Why this specific number.** Chosen from the measurements above, not guessed: 1440x900 at
 * `dpr: 2` is ~5.18M px and measured an acceptable, non-catastrophic ~1.6x cost — so the budget is
 * set to keep that *exact* common case at full retina sharpness (this is deliberately the same
 * reference point the re-measure request itself used), while a 5K-class display's own ~14.7M-px
 * request now tapers smoothly down to fit the same budget instead of paying for triple that many
 * pixels outright. The floor stays "the visual centrepiece" first: nothing here trims quality at
 * ordinary sizes, only at the sizes the data says actually cost something.
 */
const EXPANDED_DPR_BUDGET_PIXELS = 5_200_000
/** `GlobeSphere`'s own `sphereGeometry` radius — named so the pole markers below (`poles.ts`,
 *  `PoleAxisMarkers`) agree with the sphere on exactly where its surface sits. */
const GLOBE_RADIUS = 1
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

// ------------------------------------------------------------------------------ map mode

/** Equal Earth's own bounding box (`projection.ts`), scaled to this file's `GLOBE_RADIUS` —
 *  every map-mode camera calculation (`GlobeCameraControls`) is sized against these. */
const MAP_HALF_WIDTH = EQUAL_EARTH_HALF_WIDTH * GLOBE_RADIUS
const MAP_HALF_HEIGHT = EQUAL_EARTH_HALF_HEIGHT * GLOBE_RADIUS
/** Extra headroom around the map's own bounding box when framing it, so its curved edges never
 *  touch the viewport's own edge. Tightened from 0.08 (2026-09-18 lead review, "fill the space"
 *  follow-up): the panel is only ever as tall as the shell's real, often-tight title-to-timeline
 *  gap (`Globe.module.css`'s `--chrome-gap-height`), and since the map's own box is aspect-locked
 *  to ~2.05:1 (`Globe.module.css`'s `data-map-mode` rule) that gap-limited *height* also caps the
 *  map's width — every percentage point of margin costs roughly 2x itself in final width. 8%
 *  measured out to ~983px at 1440x900 (browser-verified), well short of the ~1050-1200px target;
 *  3% still leaves a real, visible gap between the map's curved edges and the panel's own edge
 *  (tighter than the sphere's own 5% — see `SPHERE_FIT_MARGIN` — because the map has that much
 *  further to make up against the same gap-limited height). */
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
/** The default expanded sphere's own "slightly larger" nudge (user follow-up, 2026-09-18: "make
 *  the globe slightly larger by default when in fullscreen view") — a named, commented constant
 *  rather than another incidental side effect of a chrome-height change (this sphere has already
 *  been resized twice this week purely as a consequence of those). Applied by *dividing* the
 *  fitted idle distance (`GlobeCameraControls`), which moves the camera closer without touching
 *  `SPHERE_FIT_MARGIN`'s own, separate meaning (breathing room at the box edge) — the two would
 *  otherwise be easy to conflate into one "how big is the sphere" knob when they answer different
 *  questions. `1.05` measured 546px -> 573px drawn diameter at 1440x900 (`globe-expanded-sphere`
 *  QA shot) — a nudge, not a redesign. */
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

/** A measured `.orbFitFrameSphere`/`.orbFitFrameMap` rectangle's size (`Globe.module.css`'s own
 *  doc comment) — width/height only; `GlobeCameraControls` never needs the raw top/left, just the
 *  aspect and the height ratio `subFrameFovY` (`camera.ts`) wants. */
interface FitFrameSize {
  width: number
  height: number
}

/** `Globe.tsx`'s own DOM-layer measurement of the two invisible fit-target rectangles plus the
 *  pixel shift (`verticalCenterOffset`, `camera.ts`) needed to re-centre the rendered sphere/map
 *  on them — see `GlobeCameraControls`'s doc comment for how all three are used. `null` until the
 *  first `ResizeObserver` pass (or when a frame isn't mounted, e.g. before `expanded`). */
interface FitMeasurements {
  sphereFit: FitFrameSize | null
  mapFit: FitFrameSize | null
  verticalOffsetPx: number
}
const EMPTY_FIT_MEASUREMENTS: FitMeasurements = { sphereFit: null, mapFit: null, verticalOffsetPx: 0 }

/** Whether the zoom-in/zoom-out buttons (`ZoomControls`) can still do anything — mirrors
 *  `OrbitControls`'s own `minDistance`/`maxDistance` for the current mode, reported by
 *  `GlobeCameraControls` so the buttons can grey out at a real limit rather than clicking with no
 *  visible effect (requirement 4: "disable ... a button when its end of the range is reached"). */
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
  /** The current scene's `location` (ADR-034), or `null`/absent for a scene with no place. Only
   *  its `marker` is ever plotted — never `presentDay`. */
  sceneLocation: SceneLocation | null
  /** `Playback.baseRate` — the timeline's own rate model. The human layer derives its arrival
   *  timing from it statically (`arrivalTimingFor`), so an arc is legible rather than a flicker at
   *  default playback speed. */
  playbackBaseRate: number
  /** Event ids whose card is currently in the event feed, and the one the viewer is hovering —
   *  an arrival's arc and marker pulse in sympathy with its own card. */
  feedEventIds: ReadonlySet<string>
  hoveredFeedEventId: string | null
}

export function Globe({
  t,
  rasterLayers,
  assetBase,
  regimeEvents,
  effectEvents,
  expanded,
  onToggleExpand,
  onCaptionChange,
  cities,
  sceneLocation,
  playbackBaseRate,
  feedEventIds,
  hoveredFeedEventId,
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

  // docs/GLOBE.md's ADR-030: the human-era basemap tier — T0 for the
  // minimised orb and phone-expanded, T1 only expanded on a desktop-class device
  // (`selectBasemapTier`). `basemapData` is `null` whenever no basemap layer is published at
  // all, or the chosen tier specifically isn't (falls back to T0's own RasterData, never to
  // `null` just because T1 alone is missing).
  const isPhoneViewport = useIsPhoneViewport()
  const t1Available = useMemo(() => supportsBasemapT1(webglProbe.maxTextureSize), [webglProbe])
  const basemapTier = selectBasemapTier(expanded, isPhoneViewport, t1Available)
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
  const onWebglContextRestored = (): void => {
    basemapTextureCache.clear()
    densityTextureCache.clear()
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

  // The human-civilisation layer (ADR-031 amendment / ADR-032 / ADR-035): transient arrival arcs,
  // the population-density overlay and city markers, under one toggle. `arrivalTiming` is derived
  // from the timeline's own playback rate once, not per frame — see `arrivalTimingFor`.
  const [humanOn, setHumanOn] = useState(true)
  const arrivalTiming = useMemo(() => arrivalTimingFor(playbackBaseRate), [playbackBaseRate])
  const densityData = rasterLayers.populationDensity
  const humanHasData =
    hasVisibleArrivals(effectEvents, t, arrivalTiming) || densityHasDataAt(densityData, t) || citiesHaveDataAt(cities, t)

  // The density overlay's own texture pair, on its own `NoColorSpace`/box-filtered cache
  // (`humanEraTextureCache.ts`) — nothing is fetched while the toggle is off or while `t` is
  // outside the layer's own domain, since `densityBlendAt` returns null for both.
  const densityBlend = useMemo(
    () => (densityData === null || !humanOn ? null : densityBlendAt(densityData, t, assetBase)),
    [densityData, humanOn, t, assetBase],
  )
  const densityPair = useGlobeTexturePair(densityBlend, [], {
    enabled: webgl,
    cache: densityTextureCache,
    resetKey: contextEpoch,
  })
  const densityStrength = densityData !== null && humanOn && densityPair.texturesReady ? densityStrengthAt(densityData, t) : 0
  const densityChannel = useMemo(
    () => densityChannelMask(densityData?.encoding?.channel ?? 'r'),
    [densityData],
  )

  // ADR-034: the scene's own plotted position. `sceneMarkerCoordinates` is the single place the
  // "never fall back to presentDay" rule lives. The small orb eases its rotation to centre it;
  // expanded or unfolded as a map the viewer is steering, so no focus target is passed at all and
  // the camera is left entirely alone.
  const sceneMarker = sceneMarkerCoordinates(sceneLocation ?? undefined)
  const sceneFocusRotationY = !expanded && sceneMarker !== null ? focusRotationY(sceneMarker.lon) : null

  // Set while a touch press lands on one of the human layer's own targets, so the orb's
  // tap-to-expand gesture stands down and the tap opens a tooltip instead.
  const humanTouchHitRef = useRef(false)

  // docs/GLOBE.md G7's fallback rule: when Merdith data is unusable, 540-1000 Ma gets the same
  // "geography unknown" regime look that already covers 1000 Ma and older, not fake continents.
  const effectiveRegimeEvents = useMemo(
    () => regimeEventsWithRasterFallback(regimeEvents, rasterLayers.neoproterozoic !== null),
    [regimeEvents, rasterLayers.neoproterozoic],
  )
  const fallbackCaption = useMemo(() => globeMultiCaptionFor(rasterLayers, t), [rasterLayers, t])
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

  // Minimised orb: OrbitControls now rotates in both states (below), so a plain expand
  // button covering the orb would swallow every drag. Instead the orb itself distinguishes a
  // click from a drag by movement, the same "did the press move" test the backdrop uses above
  // — a press-and-release under the threshold expands, anything that moved further is a
  // rotate and must not. OrbitControls captures the pointer on the canvas (three.js's
  // `setPointerCapture`), so pointerup still bubbles here with the right coordinates even when
  // released outside the orb. `expandButton` below stays for keyboard activation only.
  const orbPressStart = useRef<{ x: number; y: number } | null>(null)
  const onOrbPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    orbPressStart.current = { x: e.clientX, y: e.clientY }
  }
  const onOrbPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const start = orbPressStart.current
    orbPressStart.current = null
    if (start === null) return
    if (humanTouchHitRef.current) return
    if (isOrbClick(start, { x: e.clientX, y: e.clientY })) onToggleExpand()
  }

  // The narrow-viewport safety net (2026-09-18 lead review): a phone portrait's top-left overlay
  // stack (the Globe/Map toggle, and — beneath it — the legend) is wide enough that its own right
  // edge can sit past the *centre* of a narrow viewport, which a centred sphere or map straddles
  // by construction. `Globe.module.css`'s own narrow-viewport rule reads `--overlay-clear-bottom`
  // (whichever of the two sits lower) to keep the panel from growing underneath them — see that
  // rule's own doc comment for why a simple "clear it vertically altogether" bound, not exact
  // circle geometry, is what's actually applied. Measured directly on the DOM (not estimated),
  // the same `getBoundingClientRect` + `ResizeObserver` + `window.resize` recipe `useChromeGap`
  // uses, written onto `backdropRef`'s own element (an ancestor of both, in the same position:
  // fixed/viewport coordinate space) rather than routed through React state, for the same "don't
  // re-render every playback frame for a value nothing here reads reactively" reason.
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const viewModeToggleBoundsRef = useRef<HTMLDivElement | null>(null)
  const legendBoundsRef = useRef<HTMLDivElement | null>(null)
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
      const toggleBottom = viewModeToggleBoundsRef.current?.getBoundingClientRect().bottom ?? 0
      const legendBottom = legendBoundsRef.current?.getBoundingClientRect().bottom ?? 0
      host.style.setProperty('--overlay-clear-bottom', `${Math.max(toggleBottom, legendBottom)}px`)

      const canvasRect = host.getBoundingClientRect()
      // `?? null` down to a real, non-degenerate rect only: browser-verified, a frame's *very
      // first* `ResizeObserver` pass can report a real-but-zero-height rect for the one paint
      // before its ancestor's `--chrome-gap-height` custom property has resolved — treating that
      // as "measured" fed a bogus, full-canvas-fallback `idleSphereDistance` into
      // `GlobeCameraControls`'s one-shot "reframe on this transition" logic, which then never got
      // a second chance to correct itself (the actual bug behind the "opens zoomed in a lot"
      // report). Keeping it `null` here instead means every consumer's own existing "not measured
      // yet" fallback — already written for the ordinary pre-mount case — also covers this one,
      // rather than needing its own separate `height > 0` guard against a state this makes
      // unrepresentable in the first place.
      const sphereRectRaw = sphereFitFrameRef.current?.getBoundingClientRect() ?? null
      const sphereRect = sphereRectRaw !== null && sphereRectRaw.height > 0 ? sphereRectRaw : null
      const mapRectRaw = mapFitFrameRef.current?.getBoundingClientRect() ?? null
      const mapRect = mapRectRaw !== null && mapRectRaw.height > 0 ? mapRectRaw : null
      setFitMeasurements({
        sphereFit: sphereRect !== null ? { width: sphereRect.width, height: sphereRect.height } : null,
        mapFit: mapRect !== null ? { width: mapRect.width, height: mapRect.height } : null,
        // Both frames are centred in the same real chrome gap regardless of their own
        // width/height (`verticalCenterOffset`'s own doc comment proves this algebraically), so
        // one offset — read from whichever frame is currently mounted — serves both sphere and
        // map framing; `sphereFit` is measured first, but either would agree.
        verticalOffsetPx:
          sphereRect !== null
            ? verticalCenterOffset(sphereRect.top, sphereRect.height, canvasRect.top, canvasRect.height)
            : mapRect !== null
              ? verticalCenterOffset(mapRect.top, mapRect.height, canvasRect.top, canvasRect.height)
              : 0,
      })
    }
    recompute()
    window.addEventListener('resize', recompute)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute)
      observer.observe(host)
      for (const ref of [viewModeToggleBoundsRef, legendBoundsRef, sphereFitFrameRef, mapFitFrameRef]) {
        if (ref.current !== null) observer.observe(ref.current)
      }
    }
    return () => {
      window.removeEventListener('resize', recompute)
      observer?.disconnect()
    }
    // Re-runs whenever any observed element could have just mounted or unmounted (a
    // `ResizeObserver` can only watch a node once it exists) — `expanded`/`webgl` gate all of
    // them, `humanHasData` alone gates the legend's one row today (`Legend` itself renders
    // nothing once no row is visible).
  }, [expanded, webgl, humanHasData])

  // Imperative zoom (requirement 4, user verbatim: "might be good to add zoom in/out magnifying
  // icons/buttons to the fullscreen map/globe view") — `ZoomControls` below is plain DOM, outside
  // the `<Canvas>`'s own react-three-fiber tree, so it drives `GlobeCameraControls`'s camera
  // through this imperative ref rather than a second, parallel zoom state; `zoomBounds` is
  // reported back the same way `caption`/`onWebglContextRestored` already cross that boundary.
  const cameraApiRef = useRef<GlobeCameraApi>(null)
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
        onPointerDown={expanded ? undefined : onOrbPointerDown}
        onPointerUp={expanded ? undefined : onOrbPointerUp}
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
            camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }}
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
            // `onOrbPointerDown`/`onOrbPointerUp` below already own click-to-expand there, and
            // calling `onCollapse` — which unconditionally toggles — while collapsed would flip it
            // open by mistake). Only plain clicks close it, not right-click/double-click, matching
            // the old `onClick`-only backdrop handler.
            onPointerMissed={(event) => {
              if (expanded && event.type === 'click') onCollapse()
            }}
          >
            <GlobeRotatingGroup unfold={unfold} reducedMotion={reducedMotion} focusRotationY={sceneFocusRotationY}>
              <GlobeSphere
                beforeTex={pair.beforeTex}
                afterTex={pair.afterTex}
                mix={mix}
                hasData={showTexture}
                effects={effects.uniforms}
                unfold={unfold}
                basemapTex={basemapPair.beforeTex}
                basemapStrength={basemapStrength}
                densityBeforeTex={densityPair.beforeTex}
                densityAfterTex={densityPair.afterTex}
                densityMix={densityPair.mix}
                densityStrength={densityStrength}
                densityChannel={densityChannel}
                densityDMax={densityData?.encoding?.dMax ?? 1}
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
              verticalOffsetPx={fitMeasurements.verticalOffsetPx}
              onZoomBoundsChange={setZoomBounds}
            />
          </Canvas>
        ) : (
          // Expanded, the no-WebGL fallback instead renders inside `.orbFitFrameSphere` above
          // (that block's own comment) — this slot only fires minimised, unchanged from before.
          !expanded && <GlobeStaticOrb />
        )}

        {/* Persistent "this expands" affordance (user follow-up, 2026-09-18: "make it more
            obvious the globe can be selected"). `.expandButton`'s own ring below only shows on
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
          <button type="button" className={styles.expandButton} onClick={onToggleExpand} aria-label="Expand globe" />
        )}
      </div>

      {/* WebGL-off fallback (`GlobeStaticOrb`) has no map to unfold into, and no overlay data
          to show either — every control below is hidden outright, never shown disabled or
          faked. */}
      {expanded && webgl && <ViewModeToggle mapMode={mapMode} onChange={setMapMode} boundsRef={viewModeToggleBoundsRef} />}
      {expanded && webgl && (
        <Legend
          compact={isPhoneViewport}
          boundsRef={legendBoundsRef}
          rows={[
            {
              id: 'human-civilisation',
              label: 'Human civilisation',
              hint: 'Dispersal arcs while each migration happens, settled markers after, cities, and modelled population density (HYDE 3.2, from 10,000 BCE).',
              compactHint: 'Arcs, settlements, cities, density',
              on: humanOn,
              onChange: setHumanOn,
              visible: humanHasData,
              // Only while the layer is actually painting a density: a colour key for an overlay that
              // is switched off, or out of its own domain, is chrome with nothing to explain.
              footer: humanOn && densityHasDataAt(densityData, t) ? <DensityRampKey /> : undefined,
            } satisfies LegendRow,
          ]}
        />
      )}

      {expanded && webgl && (
        <ZoomControls
          onZoomIn={() => cameraApiRef.current?.zoomIn()}
          onZoomOut={() => cameraApiRef.current?.zoomOut()}
          canZoomIn={zoomBounds.canZoomIn}
          canZoomOut={zoomBounds.canZoomOut}
        />
      )}

      {expanded && (
        <button type="button" className={styles.closeButton} onClick={onCollapse} aria-label="Collapse globe">
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
  /** `useOverlayClearBottom`'s own measurement target — see that hook's doc comment. */
  boundsRef: RefObject<HTMLDivElement | null>
}

/** "Globe / Map" segmented control (docs/GLOBE.md's ADR-033) — same labelled-toggle idiom
 *  as `timeline/components/Transport.tsx`'s "Playback mode"/"Scale" controls: a visible small-
 *  caps label above a pill of buttons, wired to the group with `aria-labelledby` rather than a
 *  second `aria-label` repeating the same text. Only rendered while expanded (`Globe`'s own
 *  guard) — collapsing always resets `mapMode`, so this never needs to reflect a "sticky" map
 *  view when it reappears. */
function ViewModeToggle({ mapMode, onChange, boundsRef }: ViewModeToggleProps) {
  const labelId = useId()
  return (
    <div ref={boundsRef} className={styles.viewModeGroup}>
      <span id={labelId} className={styles.viewModeLabel}>
        View
      </span>
      <div className={styles.viewModeToggle} role="group" aria-labelledby={labelId}>
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
}

/** Zoom in/out (requirement 4, user verbatim: "might be good to add zoom in/out magnifying
 *  icons/buttons to the fullscreen map/globe view") — a vertical pill of two buttons, same
 *  hairline/pill idiom as `ViewModeToggle`/`Legend`'s own toggles rather than a new button
 *  language (`Globe.module.css`'s `.zoomGroup`/`.zoomButton` doc comment). Both buttons call
 *  straight into `GlobeCameraControls`'s imperative `zoomIn`/`zoomOut` (via `Globe`'s
 *  `cameraApiRef`), which dollies the *same* camera distance scroll/pinch already drives through
 *  the *same* `minDistance`/`maxDistance` clamp — never a second, parallel zoom state. Works
 *  identically in sphere and map mode (`Globe` renders this once, not per mode); `disabled`
 *  reflects `GlobeCameraControls`'s own live-reported `zoomBounds`, so a press that can't move the
 *  camera any further visibly flattens rather than doing nothing unexplained. Never hidden while
 *  the expanded view is open (project rule: nothing fades/hides on inactivity). */
function ZoomControls({ onZoomIn, onZoomOut, canZoomIn, canZoomOut }: ZoomControlsProps) {
  return (
    <div className={styles.zoomGroup}>
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
  verticalOffsetPx: number
  /** Reported every time the zoom-button bounds could have changed (`ZoomBounds`'s own doc
   *  comment) — mirrors `onCaptionChange`'s "cross the Canvas/DOM boundary via a callback" shape. */
  onZoomBoundsChange: (bounds: ZoomBounds) => void
}

/**
 * Owns `OrbitControls` for both globe states. Sphere mode is unchanged from before this feature
 * — rotate plus zoom while expanded, no pan. Map mode disables rotate (there is no "up" to spin
 * toward on a flat map), enables pan, and clamps both so the map can never be zoomed out past
 * its own fit-to-panel framing or panned off-screen (`camera.ts`'s `fitDistance`/
 * `clampPanTarget`).
 *
 * **The sphere itself is also fit to the panel, not just the map (2026-09-18 lead review).** A
 * plain expand (no map mode involved) used to leave the camera at whatever pose the *minimised*
 * orb had, since `Globe.tsx`'s minimised and expanded views share one `<Canvas>`/camera object
 * and nothing had ever told it the panel had grown — the expanded panel could be sized correctly
 * and the sphere would still render at the small orb's own loose `CAMERA_DISTANCE` scale.
 * `idleSphereDistance`/`wasExpandedRef` below fix this the same way entering/leaving map mode
 * already re-triggers `mapFit`: a plain expand/collapse now reframes to `sphereFitDistance`
 * (tight, `SPHERE_FIT_MARGIN`) or back to `CAMERA_DISTANCE` (loose, halo-friendly) respectively.
 *
 * While the toggle's own tween is still under way (`unfold` hasn't reached `mapMode`'s target
 * yet), this also steers the camera's own distance to match it, so the view zooms in/out in step
 * with the mesh flattening rather than clipping the wider map mid-animation or snapping once the
 * mesh finishes. Once settled, it stops touching `camera.position` — `OrbitControls` (bounded by
 * `minDistance`/`maxDistance` below, and by `onChange`'s pan clamp) owns the camera outright from
 * then on, so a viewer's own zoom/pan is never fought. A resize while already settled in map mode
 * updates the zoom-out cap (`maxDistance`) to the new aspect but does not itself reset the
 * viewer's current framing — only entering/leaving map mode re-triggers the animated reframe.
 *
 * The distance used mid-tween is not a bare `lerp(startDistance, mapFit, progress)`: `mapFit` is
 * the distance that fits the map once it's *fully* flattened, but the mesh's own bounding shape
 * doesn't grow linearly from a sphere's circular silhouette to that final rectangle as `unfold`
 * rises — a plain distance lerp can undershoot partway through the tween and clip the
 * partially-flattened mesh (flat cuts top/bottom/right), confirmed browser-side mid-unfold.
 * Instead, every unsettled frame, in *either* direction, also computes the distance actually
 * *required* to contain the mesh's own current bounding box — `unrolledHalfWidth`/
 * `unrolledHalfHeight` (`projection.ts`), the curvature unroll's *own* half-extents at this
 * `unfold`, not a linear lerp from `GLOBE_RADIUS` toward the map's — at the live aspect, and takes
 * whichever of the two distances is larger. This can only ever push the camera *further back*
 * than the plain lerp, never closer, so it costs nothing at the endpoints (where the lerp and the
 * fit already agree) and simply guarantees the mesh is never clipped by a camera that hasn't
 * caught up. Leaving map mode needs this exactly as much as entering it: the CSS panel's own
 * `width`/`height` snap to their target the instant `data-map-mode` changes in *either* direction
 * (`Globe.module.css`'s own doc comment), so folding back out starts this tween already
 * square-aspected while the mesh is still nearly the full-width map — the live `aspect` this
 * function reads has already changed before `unfold` has moved off 1, and without this floor
 * applying there too the still-wide mesh clips against the now-narrower square frustum (browser-
 * verified: a sharp-edged rectangle silhouette partway through, not the curvature unroll's own
 * continuously-curved shape). A linear lerp
 * of the half-extents was itself a second, independent source of the reported "jump": the real
 * silhouette's width does not grow at a constant rate (`unrolledHalfWidth`'s own doc comment has
 * the detail), so sizing the camera against that lerp instead of the mesh's *actual* current
 * extents made it visibly overshoot, then have to race the mesh's real (slower-growing at first)
 * width back down — a shrink, then a catch-up growth, confirmed in `scratchpad/transition-*`
 * frame captures browser-side. (The panel's own CSS box plays no part in this any more:
 * `Globe.module.css`'s `.orbExpanded[data-animate-resize]` snaps it to its target size, and so
 * its final aspect, the instant a Globe/Map toggle starts, before this component's own very first
 * tween frame runs — it used to animate width/height on its own slower `ease` curve, changing the
 * *aspect itself* mid-tween on top of the mesh-shape mismatch above, which is a separate problem
 * this distance floor alone doesn't solve; see that CSS rule's own doc comment.)
 *
 * **Both distances are measured from the map plane, not from the origin.** `unfoldedPosition`'s
 * curvature unroll (`projection.ts`'s own doc comment) places the *fully* flattened map at
 * `z = GLOBE_RADIUS`, not `z = 0` — the tangent point the whole sheet unrolls around never moves.
 * `controls.target` stays at `(pan, pan, 0)` throughout, exactly as it always has (changing it
 * would also change how sphere-mode orbiting feels, which this feature must not touch), so
 * `fitDistance`'s own output — a distance *to the plane* — needs `GLOBE_RADIUS` added before it's
 * a valid camera-to-*target* distance. Forgetting this offset would under-back the camera by
 * exactly `GLOBE_RADIUS` at every map-mode framing (`mapFit`, the mid-tween `requiredDistance`,
 * and the settled-mode `minDistance`/`maxDistance` zoom bounds below) — small next to the map's
 * own ~2.7-unit half-width, but a real, constant mis-framing, not a rounding error.
 *
 * **Tweening from wherever the viewer actually left the camera.** The mid-tween distance/
 * direction/pan-target above don't blend from a fixed starting pose (`CAMERA_DISTANCE`, dead
 * centre) — they blend from whatever the camera actually was the instant the tween began,
 * captured once when `settled` flips from `true` to `false` below. Without this, a viewer who had
 * rotated or zoomed the sphere before pressing "Map" saw the camera visibly snap back to the
 * default pose first and *then* animate into the map — the reported "camera jump". Folding back
 * out of map mode restores `preUnfoldDistanceRef`, the sphere's own distance at the moment map
 * mode was entered, rather than always `CAMERA_DISTANCE`, so a viewer who'd zoomed in before
 * switching to Map returns to that same zoom. The direction itself is blended with
 * `slerpDirection` (`camera.ts`), not a plain `lerp` + `normalize()`: a viewer who had orbited to
 * the globe's far side before pressing "Map" starts this tween more than 90° from the map's own
 * square-on direction `(0, 0, 1)`, where a linear lerp dips toward (or, near-antipodal, straight
 * through) the zero vector — `normalize()` of that is undefined/unstable, and even short of
 * exactly antipodal the camera visibly swings *through* the globe rather than around its surface,
 * an abrupt ~180°-ish flip (`camera.test.ts`'s own antipodal/orthogonal/identical cases pin this).
 *
 * **`enableDamping={settled}` below.** `drei`'s own `<OrbitControls>` wrapper defaults
 * `enableDamping` to `true` (three.js's own raw `OrbitControls` defaults it to `false` — a
 * different default this component previously, incorrectly, assumed applied here). With damping
 * on, a rotate/pan/zoom that was still decelerating persists a fraction of its own delta into
 * later frames (`sphericalDelta`/`panOffset`, gradually decayed by `update()` rather than fully
 * drained each call) — exactly the frames this component is also driving directly via
 * `camera.position.set(...)` above, so the two would fight for the tween's first several frames.
 * Disabling damping for precisely the tween's own span (`!settled`) makes `update()` fully drain
 * that delta on its very next call instead of decaying it, leaving nothing to fight; damping
 * resumes once settled, for the ordinary smooth-drag feel a viewer gets outside the tween.
 *
 * **`sphereFit`/`mapFit`/`verticalOffsetPx` (docs/GLOBE.md, user follow-up 2026-09-18: "currently
 * when zooming in on the globe, it's constrained by a square bounding window... can this be
 * removed").** `Globe.tsx`'s `<Canvas>` now fills the whole backdrop (`Globe.module.css`'s
 * `.orbExpanded` doc comment) instead of a chrome-gap-sized box, removing the square clip a
 * zoomed-in sphere used to hit — but the *default*, un-zoomed framing must still look the size it
 * did in that smaller box. These three props (`Globe.tsx`'s own DOM-layer measurement of two
 * invisible reference rectangles) let `idleSphereDistance`/`mapFit` below fit against that
 * rectangle instead of the canvas's own now-much-larger one, and a `camera.setViewOffset` re-
 * centres the render on it — see `idleSphereDistance`'s own comment and the `setViewOffset` effect
 * for the maths. Everything else in this component (the pan clamp, the mid-tween required-
 * distance floor, the cursor's pan-room check) keeps reasoning about the *real* canvas frustum
 * (`aspect`/`fovYRadians`, unchanged) — only the idle target distances are special-cased.
 *
 * **The imperative `zoomIn`/`zoomOut` handle (requirement 4).** `ZoomControls` (`Globe.tsx`) is
 * plain DOM, outside this react-three-fiber tree, so it can't touch `camera`/`controlsRef`
 * directly — `useImperativeHandle` below exposes exactly two methods, each going through the same
 * `zoomMinDistance`/`zoomMaxDistance` clamp `OrbitControls`' own scroll/pinch zoom already uses,
 * so the two input paths can never disagree. `onZoomBoundsChange` reports whether either button
 * would currently do anything, the same "cross the Canvas/DOM boundary via a callback" shape
 * `onCaptionChange` already uses for the caption text.
 */
const GlobeCameraControls = forwardRef<GlobeCameraApi, GlobeCameraControlsProps>(function GlobeCameraControls(
  { expanded, mapMode, unfold, sphereFit: sphereFitFrame, mapFit: mapFitFrame, verticalOffsetPx, onZoomBoundsChange },
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
  // must still reason about the *real*, full-canvas frustum: the pan clamp, the mid-tween
  // required-distance floor, and the cursor's pan-room check, all further down. Falls back to the
  // real canvas aspect/FOV when a frame hasn't been measured yet (`null`, before the first
  // `ResizeObserver` pass in `Globe.tsx`) — a one-frame full-size fallback is preferable to a
  // divide-by-zero or NaN distance.
  //
  // **`isSubFrameOf` also rejects a frame bigger than the canvas it's supposedly a sub-region of
  // (browser-verified regression, 2026-09-18: "opens zoomed in a lot, need to press zoom out 6
  // times").** `Globe.tsx`'s DOM measurement (`sphereFitFrame`) and r3f's own canvas measurement
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

  // Re-centres the rendered sphere/map on the fit frame's own vertical centre rather than the
  // (now much larger, and differently-centred — the chrome gap isn't centred in the viewport
  // either) full canvas's — `camera.ts`'s `verticalCenterOffset` computes the raw pixel shift in
  // `Globe.tsx`; this turns it into a real parallel (lens-shift) `setViewOffset`, not a target/
  // camera-position offset. A `target`/camera-position offset was considered and rejected: with
  // `controls.target` a few tenths of a world unit from the sphere's own true centre, orbiting
  // (dragging to rotate) would visibly wobble the sphere across the screen as the camera swings
  // around a point that isn't quite where the sphere actually is — `setViewOffset` shifts the
  // *projection*, independent of camera position/orientation, so the same constant screen shift
  // applies at every rotation/zoom with no such coupling. Sign: three.js's own
  // `updateProjectionMatrix` computes `top -= view.offsetY * height / view.fullHeight`; working
  // through where a world point at the sphere's own Y=0 then lands on screen gives
  // `screenY = canvasCenterY - offsetYParam` — so reproducing a *downward* shift of
  // `verticalOffsetPx` (this file's own sign convention, `camera.ts`'s doc comment) needs
  // `offsetYParam = -verticalOffsetPx`, negated below. `fullWidth`/`fullHeight` equal to the
  // canvas's own real size (not a genuinely larger virtual frame) means this is a pure shift, not
  // a crop — three.js's own multiview/tiled-rendering use of this API is the crop case; this is
  // the same primitive used for the other, less common purpose it's equally built for (a
  // shift-lens style off-centre projection). Cleared whenever minimised: `camera`/`gl` are shared
  // between the minimised and expanded views (this component's own doc comment above), so a
  // stale offset left on from a previous expand would otherwise skew the small orb too.
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    if (!expanded || size.width <= 0 || size.height <= 0) {
      perspectiveCamera.clearViewOffset()
      return
    }
    perspectiveCamera.setViewOffset(size.width, size.height, 0, -verticalOffsetPx, size.width, size.height)
  }, [camera, expanded, size.width, size.height, verticalOffsetPx])

  const wasSettledRef = useRef(settled)
  const tweenStartDirectionRef = useRef(new THREE.Vector3(0, 0, 1))
  const tweenStartDistanceRef = useRef(CAMERA_DISTANCE)
  const tweenStartTargetRef = useRef(new THREE.Vector2(0, 0))
  const preUnfoldDistanceRef = useRef(idleSphereDistance)
  // Tracks `expanded` itself, the same "did the target I settle on just change" pattern
  // `wasSettledRef` uses for `mapMode` — see the block below for why a plain expand/collapse
  // needs its own reframe trigger distinct from the map-mode one.
  const wasExpandedRef = useRef(expanded)

  const snapPendingRef = useRef(false)

  if (settled !== wasSettledRef.current) {
    wasSettledRef.current = settled
    if (settled) {
      snapPendingRef.current = true
    } else {
      const controls = controlsRef.current
      const distance = camera.position.length()
      tweenStartDistanceRef.current = distance > 1e-4 ? distance : CAMERA_DISTANCE
      tweenStartDirectionRef.current = distance > 1e-4 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1)
      if (controls !== null) tweenStartTargetRef.current.set(controls.target.x, controls.target.y)
      if (mapMode) preUnfoldDistanceRef.current = tweenStartDistanceRef.current
    }
  }

  // A plain expand/collapse (map mode untouched, `unfold` staying at 0 throughout) never flips
  // `settled` above, so it would otherwise never reframe the camera at all — the sphere would
  // simply keep whatever pose the *previous* state left it at, since `Globe.tsx`'s minimised and
  // expanded views share one `<Canvas>` (and so one camera object). That was the actual bug
  // behind the "globe renders far smaller than the panel it's given" report (2026-09-18 lead
  // review): the expanded panel could be sized correctly and the sphere would still inherit the
  // *minimised* orb's own loose `CAMERA_DISTANCE` framing, since nothing had ever told the camera
  // the panel had grown. Mirrors `wasSettledRef`'s own "snap once, on the frame the target
  // changes" shape, scoped to `!mapMode` — entering/leaving map mode already owns the camera
  // fully during and after its own tween, so this must never also fire mid-toggle. Also resets
  // the idle sphere distance a viewer may have zoomed away from: collapsing back to the minimised
  // orb should never leave it stuck at whatever zoom level the expanded sphere was left at.
  //
  // **Waits for a real `sphereFitFrame` measurement before consuming an *expanding* transition
  // (browser-verified regression, 2026-09-18).** `Globe.tsx` can only measure
  // `.orbFitFrameSphere`'s real rectangle once it has actually mounted, which — like any DOM
  // effect — happens one or more renders *after* the very first render where `expanded` flips
  // true; that first render still sees `sphereFitFrame === null` and so falls back to fitting the
  // *whole canvas* (`idleSphereDistance`'s own comment above). Snapping to that fallback distance
  // immediately would work exactly once, on the frame the transition happened, and this same `if`
  // is only entered again on the *next* `expanded` transition — so a viewer opening the expanded
  // globe would see it balloon to fill the entire viewport and stay there permanently once the
  // real, tight measurement arrived a frame later, since nothing would ever re-trigger a reframe
  // after this ref had already been marked consumed. Only advancing `wasExpandedRef` once a real
  // measurement exists (never gating the *collapsing* direction, which needs no measurement at
  // all — `CAMERA_DISTANCE` is a constant) means this block simply tries again on every
  // subsequent render until the measurement lands, then snaps exactly once with the right number.
  //
  // A plain `!== null` check here wasn't the whole story (browser-verified, user report
  // 2026-09-18: "opens zoomed in a lot, need to press zoom out 6 times") — two distinct ways for
  // `sphereFitFrame` to be non-null but still not trustworthy, both now folded into
  // `sphereFrameReady` above:
  // - `Globe.tsx`'s own measurement effect could store a real-but-degenerate `{width: 0,
  //   height: 0}` rect on the one paint before its ancestor's `--chrome-gap-height` custom
  //   property resolved — fixed at the source (that effect now only ever stores a real,
  //   non-degenerate rect, so `null` already means "not ready" here without this needing to know
  //   why a rect was untrustworthy).
  // - Even a correctly-measured, real-sized `sphereFitFrame` could arrive *before* `size` (r3f's
  //   own, independently-updating canvas measurement) had caught up from the minimised orb's old,
  //   much smaller canvas — `isSubFrameOf`'s own doc comment above has the full story; this is the
  //   one that actually reproduced the reported bug.
  const canReframeSphere = !expanded || sphereFrameReady
  if (!mapMode && canReframeSphere && expanded !== wasExpandedRef.current) {
    wasExpandedRef.current = expanded
    preUnfoldDistanceRef.current = idleSphereDistance
    if (settled) snapPendingRef.current = true
  }

  useFrame(() => {
    const controls = controlsRef.current
    if (controls === null) return
    if (settled) {
      // The tween's own last driven frame always runs one tick short of the target (the frame
      // where `unfold` finally equals it is already settled, so the block below returns early),
      // and under `prefers-reduced-motion` there is no tween at all: `unfold` snaps, so only a
      // single un-settled frame at `progress = 0` ever runs and the camera is left with the
      // *sphere's* framing over a fully flattened map. Browser-verified at 1440x900: the map
      // filled the panel edge to edge with no margin and its Pacific edges and poles clipped off,
      // against a correct fit with reduced motion off. Landing the camera on its exact target
      // once, on the frame it settles, fixes both — and is the whole of the reduced-motion
      // behaviour, which is meant to snap rather than animate.
      if (!snapPendingRef.current) return
      snapPendingRef.current = false
      const distance = mapMode ? mapFit : preUnfoldDistanceRef.current
      controls.target.set(0, 0, 0)
      camera.position.set(0, 0, distance)
      controls.update()
      return
    }
    const progress = mapMode ? unfold : 1 - unfold
    const targetDistance = mapMode ? mapFit : preUnfoldDistanceRef.current
    const lerpedDistance = THREE.MathUtils.lerp(tweenStartDistanceRef.current, targetDistance, progress)
    const currentHalfWidth = unrolledHalfWidth(unfold, GLOBE_RADIUS)
    const currentHalfHeight = unrolledHalfHeight(unfold, GLOBE_RADIUS)
    const requiredDistance = fitDistance(currentHalfWidth, currentHalfHeight, aspect, fovYRadians, MAP_FIT_MARGIN) + GLOBE_RADIUS
    // Applied in both directions, not just while entering map mode: `Globe.module.css`'s
    // `.orbExpanded[data-map-mode='true']` snaps the panel's own `width`/`height` — and so its
    // aspect — to its target the instant `data-map-mode` changes, in *either* direction (that
    // rule's own doc comment). Leaving map mode therefore starts this tween already square-
    // aspected while the mesh itself is still nearly the full-width map (`unfold` has barely
    // moved off 1), the same "the container's aspect and the mesh's own shape disagree
    // mid-tween" mismatch entering map mode already guards against — just triggered by the
    // *container* snapping ahead of the mesh instead of the other way around. Browser-verified
    // regression this fixes: a `lerpedDistance` sized for the old wide aspect left the camera too
    // close for the new square one, clipping the still-wide mesh's left/right edges into a flat
    // vertical line — the silhouette briefly reading as a sharp-cornered rectangle instead of the
    // curvature unroll's own continuously-curved shape (`projection.ts`'s `curvatureUnroll`).
    const distance = Math.max(lerpedDistance, requiredDistance)
    const start = tweenStartDirectionRef.current
    const [dx, dy, dz] = slerpDirection([start.x, start.y, start.z], [0, 0, 1], progress)
    const targetX = THREE.MathUtils.lerp(tweenStartTargetRef.current.x, 0, progress)
    const targetY = THREE.MathUtils.lerp(tweenStartTargetRef.current.y, 0, progress)
    controls.target.set(targetX, targetY, 0)
    camera.position.set(dx * distance, dy * distance, dz * distance)
    controls.update()
  })

  // Shared by the `OrbitControls` props below, `zoomBy` and `reportZoomBounds` — one definition
  // of "how far can this mode's zoom go" that scroll/pinch, the zoom buttons and their own
  // disabled state can never disagree about.
  const zoomMinDistance = mapMode ? mapFit * MAP_MIN_ZOOM_FRACTION : 0
  const zoomMaxDistance = mapMode ? mapFit : Infinity

  /** Issue 3 (user verbatim: "when it's expanded to a map it still has the 'drag hand' mouse
   *  icon... dragging doesn't do anything in this mode"). Checked what map mode actually supports
   *  before changing this (see `camera.ts`'s `mapHasPanRoom` own doc comment): panning is enabled
   *  in map mode, but has zero range at the settled default view (`mapFit`'s own margin already
   *  shows slightly *more* than the whole map), so `grab` was genuinely wrong at the exact moment
   *  reported. Written directly onto the canvas element's own `style.cursor` (bypassing React
   *  state/CSS class churn on every zoom tick, the same non-reactive-DOM-write discipline
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

  /** Reports whether the zoom buttons (`ZoomControls`, requirement 4) can still do anything —
   *  `ZOOM_BOUNDS_EPSILON` absorbs float roundoff right at a bound rather than reading as
   *  perpetually "one step left" there. `zoomMaxDistance === Infinity` (sphere mode, today's
   *  actual, pre-existing bound — not tightened by this feature) never disables zoom-out. */
  const reportZoomBounds = (): void => {
    const controls = controlsRef.current
    if (controls === null) return
    const distance = controls.target.distanceTo(camera.position)
    onZoomBoundsChange({
      canZoomIn: distance > zoomMinDistance + ZOOM_BOUNDS_EPSILON,
      canZoomOut: zoomMaxDistance === Infinity ? true : distance < zoomMaxDistance - ZOOM_BOUNDS_EPSILON,
    })
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
        controls.update()
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

  /** One press of `ZoomControls`' `+`/`−` (requirement 4) — dollies `camera.position` toward or
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
      rotateSpeed={0.6}
      minDistance={zoomMinDistance}
      maxDistance={zoomMaxDistance}
      onChange={onControlsChange}
    />
  )
})

// ------------------------------------------------------------------------------- rotation

interface GlobeRotatingGroupProps {
  /** 0 (sphere) .. 1 (map) — `useGlobeAutoRotationY`'s own eased-to-square-on-and-back
   *  behaviour over this same span. */
  unfold: number
  reducedMotion: boolean
  /** The angle that centres the current scene's location (ADR-034), or `null` for none. Handed
   *  to the same accumulator that owns the drift rather than applied as a second rotation. */
  focusRotationY: number | null
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
function GlobeRotatingGroup({ unfold, reducedMotion, focusRotationY, children }: GlobeRotatingGroupProps) {
  const groupRef = useRef<THREE.Group>(null)
  const rotationYRef = useGlobeAutoRotationY({ unfold, reducedMotion, focusRotationY })
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
  /** 0 (sphere) .. 1 (Equal Earth map) — `GLOBE_VERTEX_SHADER`'s `uUnfold` (docs/GLOBE.md's
   *  ADR-033). */
  unfold: number
  /** docs/GLOBE.md's ADR-030: the human-era basemap texture (`null` until loaded, or when
   *  no basemap layer is published) and its crossfade weight over the ordinary PaleoDEM base. */
  basemapTex: THREE.Texture | null
  basemapStrength: number
  /** ADR-031 amendment: the two bracketing `hyde_population_density` frames, the mix between
   *  them, the overlay's own fade-in weight, and the published decode parameters. `strength` is 0
   *  whenever the layer isn't published, the toggle is off, or `t` is outside its domain — in
   *  which case the shader term is a no-op and the placeholder textures are never sampled for
   *  anything visible. */
  densityBeforeTex: THREE.Texture | null
  densityAfterTex: THREE.Texture | null
  densityMix: number
  densityStrength: number
  densityChannel: readonly [number, number, number]
  densityDMax: number
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
  unfold,
  basemapTex,
  basemapStrength,
  densityBeforeTex,
  densityAfterTex,
  densityMix,
  densityStrength,
  densityChannel,
  densityDMax,
  onWebglContextRestored,
}: GlobeSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  // Rebuilt only if the segment counts ever change (they don't, today) — `globeGeometry.ts`'s
  // grid needs no three.js render context, so this is cheap and safe in a plain `useMemo`.
  const geometry = useMemo(() => buildGlobeGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // docs/GLOBE.md's ADR-030: forces the human-era basemap texture's GPU upload the
  // moment it arrives here, then closes its backing ImageBitmap (`initAndCloseHumanEraTexture`,
  // `humanEraTextureCache.ts`'s own doc comment — this is the fix for a real, browser-verified
  // race: closing the bitmap on a fixed frame-count guess instead of this synchronous upload
  // left the texture permanently blank on a cold cache's first expand). `GlobeSphere` is the
  // one place in this file with `useThree()` access to the renderer; `initedRef` is a `WeakSet`
  // so a texture already handled (including the shared `PLACEHOLDER_TEXTURE`, which has no
  // `ImageBitmap` image to close anyway) is never re-initialised on a later render.
  const { gl } = useThree()
  const initedTexturesRef = useRef<WeakSet<THREE.Texture>>(new WeakSet())
  useEffect(() => {
    // Every human-era texture (basemap tier, both density frames) needs the same treatment — they
    // all come from `humanEraTextureCache`, which closes their backing `ImageBitmap` the moment
    // this forced upload has happened.
    for (const texture of [basemapTex, densityBeforeTex, densityAfterTex]) {
      if (texture === null || initedTexturesRef.current.has(texture)) continue
      initedTexturesRef.current.add(texture)
      initAndCloseHumanEraTexture(gl, texture)
    }
  }, [gl, basemapTex, densityBeforeTex, densityAfterTex])

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
      uDensityBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uDensityAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uDensityMix: { value: 0 },
      uDensityChannel: { value: [1, 0, 0] },
      uDensityDMax: { value: 1 },
      uDensityStrength: { value: 0 },
    }),
    [],
  )

  useFrame((_state, delta) => {
    clockRef.current += delta
    uniforms.uTime.value = clockRef.current
  })

  const { regimeWeights, impactFlashAnchorUv } = effects
  const anchorUv = impactFlashAnchorUv !== null ? [impactFlashAnchorUv.u, impactFlashAnchorUv.v] : NO_ANCHOR_UV

  return (
    <mesh ref={meshRef} geometry={geometry} scale={GLOBE_RADIUS} frustumCulled={false}>
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
        uniforms-uDensityBefore-value={densityBeforeTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uDensityAfter-value={densityAfterTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uDensityMix-value={densityMix}
        uniforms-uDensityChannel-value={densityChannel}
        uniforms-uDensityDMax-value={densityDMax}
        uniforms-uDensityStrength-value={densityStrength}
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
