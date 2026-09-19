'use client'

/**
 * The human-civilisation layer's scene graph: transient arrival arcs, the "inhabited" markers a
 * first settlement leaves at its destination and which themselves fade out once the arrival has
 * finished playing, major-city markers, the current scene's location indicator, and the one
 * tooltip all of them share. The population-density overlay is the fourth
 * part of the same layer, but it is a texture on the sphere itself (`shaders.ts`'s `uDensity*`
 * uniforms), so it lives in `Globe.tsx`'s own material rather than here.
 *
 * Everything visible is a pure function of `t` (`arcs.ts`, `cities.ts` — both unit-tested without
 * a canvas), **including how much of a travelling arc is drawn**: the ribbon reveals
 * progressively from origin toward destination as `t` moves through the migration
 * (`ArrivalPresentation.travelProgress`, `ARC_FRAGMENT_SHADER`'s own doc comment), with an
 * arrowhead (`ArrowHead`) at its leading edge. Two things still animate on wall-clock time and
 * neither decides *what* is on screen, only how it moves: the sympathetic breathe of a marker or
 * arc whose event card is showing, and the scene-location ring's own breathe. Scrubbing to a
 * given `t` from either direction reproduces exactly the same set of drawables at the same
 * strengths and the same reveal.
 *
 * **One instanced field, not one mesh per dot.** Every marker — arrival ring, landing ripple,
 * inhabited, city, scene location — is an instance in a single `MarkerField`, so the full
 * 242-city expanded set costs one draw call and zero per-frame JS. Arcs stay individual meshes
 * because each is its own ribbon geometry, but only the handful actually in flight (or ghosted by
 * a trace) render at all.
 *
 * **Labels.** A city's full name/country/population still only ever appears in the shared
 * tooltip, on hover — ADR-032's call against permanent screen-space labels stands: at globe scale
 * a labelled set overlaps constantly, and a collision cull that silently drops half of them is
 * worse than a tooltip that always answers. What *is* drawn, expanded only (sphere or map, never
 * the orb), is a small transient name tag when a city first appears — `cities.ts`'s
 * `newCityLabels`, faded purely by `t`'s distance from the city's own first-appearance time
 * (`cityLabelOpacityAt`), never by a wall-clock timer, so scrubbing back to a city's founding
 * always brings its label back. Capped (`CITY_LABEL_CAP`) since the published set has cohorts of
 * cities sharing the exact same first-appearance `t`.
 *
 * A label only ever shows for a city that can actually be seen: `cityLabelVisibility` multiplies
 * the `t`-driven fade above by the same limb test the dot itself is already subject to
 * (`sphereMarkerVisibility`, `arcs.ts` — round the back of the sphere in globe mode, skipped once
 * unfolded past the midpoint, exactly `GlobeTooltip.tsx`'s own `projectAnchor`) and a hard
 * off-screen discard when the marker falls outside the camera's frustum (zoomed map, panned
 * sphere). Never clamped back into view the way the pointer-following tooltip deliberately is — an
 * unrequested label dragged to the screen edge would point at nothing. Both are about the
 * *camera*, not the clock, so they need their own per-frame `useFrame` (`CityLabelItem`) rather
 * than the plain-render-time computation everything else in this file uses: camera drag/auto-rotate
 * moves the view without `t` changing or this component re-rendering.
 */

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import * as THREE from 'three'

import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { FeatureData, GeoTime, TimelineEvent } from '@/types/layer'
import type { SceneCoordinates } from '@/types/manifest'

import {
  arrivalPresentationAt,
  arrivalWindow,
  arrowheadPlacementAt,
  buildArrivalIndex,
  buildFatLineBuffers,
  sphereMarkerVisibility,
  traceToOrigin,
  type ArrivalIndex,
  type ArrivalRecord,
  type ArrivalTiming,
  type ArrowheadPlacement,
  type DistancedAnchor,
} from './arcs'
import {
  allCitiesAt,
  CITY_LIMIT_ORB,
  cityEstimateRange,
  cityLocalPosition,
  declutterCities,
  newCityLabels,
  selectCities,
  type CityAtTime,
  type CityLabel,
} from './cities'
import { srgbHexToLinear } from './color'
import { smoothstep as easeSmoothstep } from './effects/math'
import { GlobeTooltip, useGlobeHitTest, type GlobeHitCandidate, type GlobeHitTarget } from './GlobeTooltip'
import { glslFloat } from './glsl'
import {
  ARC_MAP_LIFT,
  ARC_SPHERE_LIFT,
  ARRIVAL_COLOR,
  ARRIVAL_GHOST_COLOR,
  CITY_COLOR,
  INHABITED_COLOR,
  MARKER_MAP_LIFT,
  MARKER_SPHERE_LIFT,
  SCENE_LOCATION_COLOR,
} from './humanStyle'
import { MarkerField, type GlobeMarker } from './MarkerField'
import { PROJECTION_GLSL, unfoldedLiftedPosition } from './projection'

// ------------------------------------------------------------------------------------- arcs

/**
 * A camera-facing ribbon, not a 1px `gl.LINE_STRIP` (which every mainstream WebGL backend clamps
 * to one device pixel regardless of `gl.lineWidth`). Each point contributes two vertices
 * (`aSide = -1`/`+1`, `arcs.ts`'s `buildFatLineBuffers`); this shader expands them apart in
 * *screen space* by `uHalfWidthPx` CSS pixels, perpendicular to the point's own local tangent
 * (estimated from its immediate neighbours, `aDirA`/`aDirB` — shared by both `aSide` copies of one
 * point index so adjacent quads agree on the tangent and don't show a seam).
 *
 * `uResolution` is the canvas size in *CSS* pixels (`useThree().size`, not multiplied by device
 * pixel ratio): an NDC offset computed against CSS-px resolution is automatically DPR-correct —
 * three.js already maps the full -1..1 NDC range to the real (DPR-scaled) framebuffer.
 *
 * The offset is applied to `gl_Position.xy` scaled by `gl_Position.w` (perspective-correct),
 * using the *centre* point's own clip depth for both side vertices, so depth-testing against the
 * sphere is unaffected by the width expansion.
 */
const ARC_VERTEX_SHADER = /* glsl */ `
attribute vec2 aLonLat;
attribute vec2 aDirA;
attribute vec2 aDirB;
attribute float aSide;
attribute float aDistance;
uniform float uUnfold;
uniform float uHalfWidthPx;
uniform vec2 uResolution;

${PROJECTION_GLSL}

varying float vDistance;

vec3 arcPosition(vec2 lonLat) {
  return unfoldedLiftedPosition(lonLat, uUnfold, ${glslFloat(ARC_SPHERE_LIFT)}, ${glslFloat(ARC_MAP_LIFT)});
}

void main() {
  vDistance = aDistance;
  vec4 clipSelf = projectionMatrix * modelViewMatrix * vec4(arcPosition(aLonLat), 1.0);
  vec4 clipA = projectionMatrix * modelViewMatrix * vec4(arcPosition(aDirA), 1.0);
  vec4 clipB = projectionMatrix * modelViewMatrix * vec4(arcPosition(aDirB), 1.0);

  vec2 ndcA = clipA.xy / clipA.w;
  vec2 ndcB = clipB.xy / clipB.w;
  vec2 screenDir = (ndcB - ndcA) * uResolution;
  float screenLen = length(screenDir);
  vec2 tangent = screenLen > 1e-5 ? screenDir / screenLen : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);

  vec2 offsetPx = normal * aSide * uHalfWidthPx;
  vec2 offsetNdc = (offsetPx / uResolution) * 2.0;

  gl_Position = clipSelf;
  gl_Position.xy += offsetNdc * clipSelf.w;
}
`

/**
 * The arc's own colour is flat; what moves is how much of the ribbon is lit.
 *
 * `uReveal` is `ArrivalPresentation.travelProgress` (arcs.ts): 0 at the window's `tMax`, 1 at
 * `established` and for the whole fade-out tail after it. Each vertex's own cumulative
 * `vDistance` (0 at the origin, 1 at the destination — `arcs.ts`'s `DistancedAnchor`, carried
 * through unchanged by `buildFatLineBuffers`) is compared against it: lit while `vDistance <=
 * uReveal`, dark beyond, with a short soft gradient at the boundary (`REVEAL_SOFTNESS`) rather
 * than a hard cut — a hard edge reads as an abruptly clipped line, especially right where the
 * arrowhead (`ArrowHead` below) sits; the gradient reads instead as the ribbon trailing off into
 * its own leading point, and it's sized as a *fraction of the arc's own length* (not CSS pixels),
 * so it looks the same proportion of the journey at any physical zoom, orb or expanded.
 * `doneMask` keeps the *whole* arc lit once travel is complete (`uReveal >= 1`) even right at
 * `vDistance == 1`, where the plain gradient formula would otherwise clip the very last sliver —
 * the tail's own fade-out (`uAlpha`) is what dims the arc from there, not this reveal term.
 *
 * `uSympathy` is the event feed's own affordance: while an arrival's card is on screen (stronger
 * while the viewer hovers it) its arc breathes, so card and globe are visibly the same subject.
 */
const ARC_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uReveal;
uniform float uSympathy;
uniform float uTime;
varying float vDistance;

const float REVEAL_SOFTNESS = 0.04;

void main() {
  float doneMask = step(0.999, uReveal);
  float edgeFade = 1.0 - smoothstep(uReveal - REVEAL_SOFTNESS, uReveal, vDistance);
  float reveal = max(doneMask, edgeFade);

  float breathe = sin(uTime * 4.2) * 0.5 + 0.5;
  float alpha = clamp(uAlpha * reveal * (1.0 + 0.45 * uSympathy * breathe), 0.0, 1.0);

  gl_FragColor = vec4(uColor, alpha);

  #include <colorspace_fragment>
}
`

/** Half-width in CSS pixels — ~2.6px total width. */
const ARC_HALF_WIDTH_PX = 1.3

const ARC_COLOR = new THREE.Color(...srgbHexToLinear(ARRIVAL_COLOR))
const ARC_GHOST_COLOR = new THREE.Color(...srgbHexToLinear(ARRIVAL_GHOST_COLOR))

interface ArcSegmentProps {
  points: readonly DistancedAnchor[]
  color: THREE.Color
  alpha: number
  /** `ArrivalPresentation.travelProgress` — see `ARC_FRAGMENT_SHADER`'s own doc comment. */
  reveal: number
  sympathy: number
  unfold: number
}

function ArcSegment({ points, color, alpha, reveal, sympathy, unfold }: ArcSegmentProps) {
  const { size } = useThree()

  const mesh = useMemo(() => {
    const buffers = buildFatLineBuffers(points)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('aLonLat', new THREE.BufferAttribute(buffers.lonLat, 2))
    geometry.setAttribute('aDirA', new THREE.BufferAttribute(buffers.dirA, 2))
    geometry.setAttribute('aDirB', new THREE.BufferAttribute(buffers.dirB, 2))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(buffers.side, 1))
    geometry.setAttribute('aDistance', new THREE.BufferAttribute(buffers.distance, 1))
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uUnfold: { value: 0 },
        uColor: { value: ARC_COLOR },
        uAlpha: { value: 0 },
        uReveal: { value: 0 },
        uSympathy: { value: 0 },
        uTime: { value: 0 },
        uHalfWidthPx: { value: ARC_HALF_WIDTH_PX },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: ARC_VERTEX_SHADER,
      fragmentShader: ARC_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    })
    return new THREE.Mesh(geometry, material)
  }, [points])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )

  useFrame((state) => {
    const material = mesh.material as THREE.ShaderMaterial
    material.uniforms.uUnfold!.value = unfold
    material.uniforms.uColor!.value = color
    material.uniforms.uAlpha!.value = alpha
    material.uniforms.uReveal!.value = reveal
    material.uniforms.uSympathy!.value = sympathy
    material.uniforms.uTime!.value = state.clock.elapsedTime
    ;(material.uniforms.uResolution!.value as THREE.Vector2).set(size.width, size.height)
  })

  return <primitive object={mesh} frustumCulled={false} />
}

// --------------------------------------------------------------------------------- arrowhead

/**
 * A small solid triangle marking the leading edge of a travelling arc, making its direction
 * explicit rather than relying on the reveal animation alone, which reads clearly only while
 * actively scrubbing.
 *
 * Sized in CSS pixels via the same screen-space technique the arc ribbon
 * (`ARC_VERTEX_SHADER`) and the instanced marker field (`MarkerField.tsx`'s `MARKER_VERTEX_SHADER`)
 * both already use — project two nearby points, take the *screen-space* direction between them,
 * offset in pixels scaled by `1 / uResolution` — rather than a second, three-dimensional sizing
 * mechanism: `uAnchorLonLat` is the tip (`ArrowheadPlacement.anchor`) and `uTailLonLat` a point a
 * short distance behind it along the same great circle (`ArrowheadPlacement.tail`), and the
 * triangle is built entirely from the screen-space tangent/normal between their projections, so it
 * reads the same physical size on the small corner orb and the expanded globe alike, and rotates
 * correctly through the sphere/map unfold (both project through the same `unfoldedLiftedPosition`
 * twin the ribbon uses).
 */
const ARROW_VERTEX_SHADER = /* glsl */ `
attribute vec2 aCorner;
uniform vec2 uAnchorLonLat;
uniform vec2 uTailLonLat;
uniform float uUnfold;
uniform float uSizePx;
uniform vec2 uResolution;

${PROJECTION_GLSL}

vec3 arrowPosition(vec2 lonLat) {
  return unfoldedLiftedPosition(lonLat, uUnfold, ${glslFloat(ARC_SPHERE_LIFT)}, ${glslFloat(ARC_MAP_LIFT)});
}

void main() {
  vec4 clipAnchor = projectionMatrix * modelViewMatrix * vec4(arrowPosition(uAnchorLonLat), 1.0);
  vec4 clipTail = projectionMatrix * modelViewMatrix * vec4(arrowPosition(uTailLonLat), 1.0);

  vec2 ndcAnchor = clipAnchor.xy / clipAnchor.w;
  vec2 ndcTail = clipTail.xy / clipTail.w;
  vec2 screenDir = (ndcAnchor - ndcTail) * uResolution;
  float screenLen = length(screenDir);
  // Points "forward", tail -> anchor (the direction of travel) — falls back to an arbitrary axis
  // when the two points coincide (arrival just starting, tail clamped to the same point as the
  // anchor), the same degenerate-tangent guard the arc ribbon's own vertex shader uses.
  vec2 tangent = screenLen > 1e-5 ? screenDir / screenLen : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);

  // aCorner.x: 0 at the tip (sits exactly on the anchor), -1 at the back of the arrowhead.
  // aCorner.y: perpendicular spread, so the back of the triangle is wider than its tip.
  vec2 offsetPx = tangent * aCorner.x * uSizePx + normal * aCorner.y * uSizePx;
  vec2 offsetNdc = (offsetPx / uResolution) * 2.0;

  gl_Position = clipAnchor;
  gl_Position.xy += offsetNdc * clipAnchor.w;
}
`

const ARROW_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;

void main() {
  gl_FragColor = vec4(uColor, uAlpha);
  #include <colorspace_fragment>
}
`

/** Local arrow-space corners: a tip at the origin and two back corners, narrower than the ribbon's
 *  own width is tall so the shape reads as an arrowhead rather than a wedge. One triangle, drawn
 *  directly (not an instanced billboard quad + SDF mask like `MarkerField`'s round markers) since
 *  an oriented triangle needs no soft-edge mask to read cleanly at this size. */
const ARROW_CORNERS = new Float32Array([0, 0, -1, 0.42, -1, -0.42])
const ARROW_INDICES = new Uint16Array([0, 1, 2])
/** Length in CSS pixels, tip to back — comparable to the round markers' own diameters
 *  (`ARRIVAL_RING_RADIUS_PX * 2 = 8.4`, `INHABITED_RADIUS_PX * 2 = 6.8`) so the arrowhead reads as
 *  part of the same family rather than a mismatched accent. */
const ARROW_SIZE_PX = 9
/** How much of the journey (in `travelProgress`) the arrowhead takes to fade in from nothing —
 *  avoids both a jarring pop-in right as travel begins and the degenerate zero-length tangent at
 *  `travelProgress === 0`, where `tail` clamps to the same point as `anchor`. */
const ARROW_FADE_IN_PROGRESS = 0.05

interface ArrowHeadProps {
  placement: ArrowheadPlacement
  color: THREE.Color
  alpha: number
  unfold: number
}

function ArrowHead({ placement, color, alpha, unfold }: ArrowHeadProps) {
  const { size } = useThree()

  const mesh = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(ARROW_CORNERS, 2))
    geometry.setIndex(new THREE.BufferAttribute(ARROW_INDICES, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uUnfold: { value: 0 },
        uAnchorLonLat: { value: new THREE.Vector2() },
        uTailLonLat: { value: new THREE.Vector2() },
        uColor: { value: color },
        uAlpha: { value: 0 },
        uSizePx: { value: ARROW_SIZE_PX },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: ARROW_VERTEX_SHADER,
      fragmentShader: ARROW_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    })
    return new THREE.Mesh(geometry, material)
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )

  useFrame(() => {
    const material = mesh.material as THREE.ShaderMaterial
    material.uniforms.uUnfold!.value = unfold
    material.uniforms.uColor!.value = color
    material.uniforms.uAlpha!.value = alpha
    ;(material.uniforms.uAnchorLonLat!.value as THREE.Vector2).set(placement.anchor.lon, placement.anchor.lat)
    ;(material.uniforms.uTailLonLat!.value as THREE.Vector2).set(placement.tail.lon, placement.tail.lat)
    ;(material.uniforms.uResolution!.value as THREE.Vector2).set(size.width, size.height)
  })

  return <primitive object={mesh} frustumCulled={false} />
}

// ---------------------------------------------------------------------------------- markers

const INHABITED_RGB = srgbHexToLinear(INHABITED_COLOR)
const ARRIVAL_RGB = srgbHexToLinear(ARRIVAL_COLOR)
const CITY_RGB = srgbHexToLinear(CITY_COLOR)
const SCENE_RGB = srgbHexToLinear(SCENE_LOCATION_COLOR)

/** Instance budget: 25 arrivals may each contribute a destination ring and a landing ripple, the
 *  expanded view draws every city that clears the significance floor and screen-space declutter
 *  (`cities.ts`'s `allCitiesAt`/`citySignificanceFloorAt`/`declutterCities`) — well under the full
 *  published set at any `t` in practice, but the cap stays sized for the theoretical worst case
 *  plus the scene location's own dot and pulse ring, around 320 instances. 512 leaves headroom for
 *  a larger published set without a reallocation. `MarkerField`'s own buffers are allocated once at
 *  this size (`useMemo` keyed on `capacity`) and rewritten only when the marker *set* changes,
 *  never per frame, so raising this is a one-time allocation cost, not a per-frame one. */
const MARKER_CAPACITY = 512

/**
 * Minimum on-screen gap, in CSS pixels, between a kept city dot's centre and a smaller city's,
 * before `cities.ts`'s `declutterCities` drops the smaller one. Large enough that two max-size dots
 * (`CITY_MAX_RADIUS_PX * 2` = 14px) read as distinct circles with real breathing room, small enough
 * that a sparse region — where no two cities ever land this close on screen — keeps everything it
 * has. Calibrated against `scripts/qa/_declutter_verify.mjs`.
 */
const CITY_DECLUTTER_MIN_SEPARATION_PX = 14

/** One "zoom step" for `useZoomBucket`, as a fraction change in camera distance (`Math.log(1.15)`
 *  ~ 15%) — loose enough to noticeably ease the declutter as a viewer zooms in, tight enough to
 *  damp sub-percent camera jitter that would otherwise flip a borderline city in and out. */
const ZOOM_BUCKET_STEP = Math.log(1.15)

/**
 * Camera distance from the world origin, quantised into `ZOOM_BUCKET_STEP`-sized steps, updating
 * only when the viewer crosses into a new step. Read every frame (`OrbitControls` mutates the
 * camera directly with no render-triggering signal of its own), but only triggers a `setState`
 * — and so only reruns the caller's `declutterCities` pass — on a bucket crossing, not every frame.
 *
 * Reacts to zoom (camera distance) and nothing else: `cityLocalPosition`'s local-space distances
 * are already rotation/pan invariant, so only the local-to-screen-pixel conversion (which scales
 * with 1/distance) needs the camera at all. Returns the quantised distance so the caller's
 * `useMemo` sees a stable value between bucket crossings rather than a new number every frame.
 */
function useZoomBucket(camera: THREE.Camera, active: boolean): number {
  const bucketRef = useRef(0)
  const [bucket, setBucket] = useState(0)
  useFrame(() => {
    if (!active) return
    const distance = camera.position.length()
    if (!(distance > 0)) return
    const next = Math.round(Math.log(distance) / ZOOM_BUCKET_STEP)
    if (next !== bucketRef.current) {
      bucketRef.current = next
      setBucket(next)
    }
  })
  return Math.exp(bucket * ZOOM_BUCKET_STEP)
}

const INHABITED_RADIUS_PX = 3.4
const ARRIVAL_RING_RADIUS_PX = 4.2
const RIPPLE_MAX_SCALE = 4
const SCENE_MARKER_RADIUS_PX = 4.5
/** A city dot's own alpha before `trailingFade` scales it down. */
const CITY_ALPHA = 0.92
/** The location ring's radius as a multiple of the dot's. */
const SCENE_RING_SCALE = 2.4

/** How strongly an arc or marker breathes while its event card is merely on screen, versus while
 *  the viewer is actually hovering that card. */
const FEED_SYMPATHY = 0.4
const HOVERED_SYMPATHY = 1
/** A traced chain's ghosted arcs: dim enough to read as "this is history, not now". */
const TRACE_GHOST_ALPHA = 0.42

// --------------------------------------------------------------------------- tooltip content

/** Tolerances in CSS pixels — an arc is a long thin target and can afford to be generous; a city
 *  dot sits among its neighbours and cannot. */
const ARC_TOLERANCE_PX = 7
const MARKER_TOLERANCE_PX = 11

function arrivalTarget(record: ArrivalRecord, kind: 'arrival' | 'inhabited'): GlobeHitTarget {
  const [newest, oldest] = arrivalWindow(record.effect)
  return {
    kind,
    id: `${kind}:${record.eventId}`,
    eventId: record.eventId,
    title: record.event.label,
    description: record.event.description,
    dateRange: kind === 'inhabited' ? `Inhabited since ${formatGeoTime(record.effect.established)}` : formatTimeRange([newest, oldest]),
    anchor: record.effect.destination,
  }
}

/** Population with a thousands separator — the attested figure, never the interpolated one the
 *  marker is currently sized by (`cities.ts`'s own doc comment on why that distinction matters). */
function formatPopulation(population: number): string {
  return Math.round(population).toLocaleString('en-US')
}

/** The stable "nothing traced" value — see `resolveTracedIds`'s own doc comment on why reusing one
 *  reference here (rather than a fresh `new Set()`) matters. */
const EMPTY_TRACED_IDS: ReadonlySet<string> = new Set()

/**
 * The traced-chain id set for whatever `eventId` is currently hovered, keyed on that `eventId`
 * alone rather than on the hovered target object: `candidatesRef` rebuilds with fresh target
 * objects on every `t` change (playback), and a city target's `eventId` is always `null` — keying
 * on the target object itself would mint a new `Set` on every distinct city hovered across the
 * map's ~280 dots despite the traced chain always being empty, which in turn gives a caller's own
 * memo (`HumanCivilisation`'s `markers`) a new identity on every pointermove and forces
 * `MarkerField` to rewrite and re-upload its GPU buffers on every hover flicker during a drag, not
 * just when the marker set actually changed. `EMPTY_TRACED_IDS` keeps the "nothing traced" case a
 * single stable reference across renders, so a caller's `useMemo` keyed on this return value only
 * ever re-runs for an actual change in what is traced. Exported for `HumanCivilisation.test.tsx`.
 */
export function resolveTracedIds(index: ArrivalIndex, hoveredEventId: string | null): ReadonlySet<string> {
  return hoveredEventId === null ? EMPTY_TRACED_IDS : new Set(traceToOrigin(index, hoveredEventId))
}

/** `dateRange` names this as the span of attested population readings, not the city's lifespan —
 *  a city can (and often does) keep being drawn past its newest reading (`CITY_TRAILING_GRACE_T`,
 *  `cities.ts`), so a range worded like a start/end of existence would contradict the marker. */
export function cityTarget(city: CityAtTime, t: GeoTime): GlobeHitTarget {
  const [newest, oldest] = cityEstimateRange(city.feature)
  return {
    kind: 'city',
    id: `city:${city.feature.id}`,
    eventId: null,
    title: city.feature.name,
    description: `${city.feature.country} · about ${formatPopulation(city.population)} people at ${formatGeoTime(t)}`,
    dateRange: `Records: ${formatTimeRange([newest, oldest])}`,
    anchor: { lat: city.feature.lat, lon: city.feature.lon },
  }
}

// ------------------------------------------------------------------------------- city labels

/**
 * The small transient name tag a city gets when it first appears. Positioned exactly like
 * `GlobeTooltip.tsx`'s own tooltip — drei's `Html` at the marker's `unfoldedLiftedPosition`, so it
 * tracks the globe through rotation and the sphere/map unfold without re-deriving a screen
 * position itself — but with no edge clamp: these are decorative and small, drawn several at
 * once, and the tooltip's own clamp logic exists for a single larger panel that must never be cut
 * off, which isn't this. Styled inline rather than through `Globe.module.css`; the values mirror
 * `.tooltip`'s own (mono HUD font, near-black translucent chip) so it reads as the same family
 * rather than a new visual language.
 */
const CITY_LABEL_STYLE: CSSProperties = {
  pointerEvents: 'none',
  transform: 'translate(7px, -50%)',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--hud-mono, ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace)',
  fontSize: 9,
  letterSpacing: '0.03em',
  color: 'var(--hud-ink, #efe9dc)',
  background: 'rgba(3, 4, 6, 0.78)',
  border: '1px solid var(--hud-hairline, rgba(239, 233, 220, 0.18))',
  borderRadius: 4,
  padding: '2px 5px',
  opacity: 0,
}

/**
 * The label's own draw-alpha multiplier for whether the city it names can actually be seen right
 * now — independent of, and multiplied against, its `t`-driven fade (`cityLabelOpacityAt`). Pure
 * (plain tuples, no `THREE` types) so it is unit-testable without a canvas, matching
 * `sphereMarkerVisibility` (`arcs.ts`) itself, which it wraps for the limb half of the test.
 *
 * - **Off-screen** (`ndc` outside `[-1, 1]` in x/y, or behind the camera — `ndc[2] > 1`): 0,
 *   unconditionally. A zoomed-in map or a panned sphere can put a marker outside the viewport
 *   entirely; the label must not be dragged back into view the way the pointer-following tooltip
 *   deliberately is (`GlobeTooltip.tsx`'s `clampedPosition`) — an unrequested label at the screen
 *   edge would point at nothing real.
 * - **Round the back of the sphere** (globe mode only — `unfold >= 0.5` skips this entirely, the
 *   same shortcut `GlobeTooltip.tsx`'s `projectAnchor` uses, since the flattened map has no back
 *   face): `sphereMarkerVisibility`'s own smooth limb fade, so a city rotating into view brings
 *   its name with it smoothly instead of the label popping in a beat after (or before) its dot.
 */
export function cityLabelVisibility(
  worldPosition: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  radius: number,
  unfold: number,
  ndc: readonly [number, number, number],
): number {
  const onScreen = Math.abs(ndc[0]) <= 1 && Math.abs(ndc[1]) <= 1 && ndc[2] <= 1
  if (!onScreen) return 0
  return unfold >= 0.5 ? 1 : sphereMarkerVisibility(worldPosition, cameraPosition, radius)
}

const labelScratchLocal = new THREE.Vector3()
const labelScratchWorld = new THREE.Vector3()

interface CityLabelItemProps {
  label: CityLabel
  unfold: number
  radius: number
  groupRef: MutableRefObject<THREE.Group | null>
}

/**
 * One label. Its own `useFrame` — not a plain render-time computation like everything else in
 * this file — because camera drag/auto-rotate changes `cityLabelVisibility`'s answer every frame
 * without `t` changing or this component re-rendering (see this module's own doc comment,
 * "Labels"). The div's `opacity` is written directly via a ref rather than through React state,
 * the same reason `ArcSegment`/`ArrowHead` write shader uniforms straight into a ref each frame:
 * a value that changes every frame has no business going through a React re-render.
 */
function CityLabelItem({ label, unfold, radius, groupRef }: CityLabelItemProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const { camera } = useThree()
  const anchor = { lat: label.feature.lat, lon: label.feature.lon }
  const [x, y, z] = unfoldedLiftedPosition(anchor, unfold, radius, MARKER_SPHERE_LIFT, MARKER_MAP_LIFT)

  useFrame(() => {
    const group = groupRef.current
    const element = elementRef.current
    if (group === null || element === null) return
    labelScratchLocal.set(x, y, z)
    group.localToWorld(labelScratchWorld.copy(labelScratchLocal))
    const worldPosition: [number, number, number] = [labelScratchWorld.x, labelScratchWorld.y, labelScratchWorld.z]
    const cameraPosition: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
    // `.project` mutates in place; `worldPosition` above is already captured, so reusing the same
    // scratch vector for the NDC projection next is safe.
    labelScratchWorld.project(camera)
    const ndc: [number, number, number] = [labelScratchWorld.x, labelScratchWorld.y, labelScratchWorld.z]
    const visibility = cityLabelVisibility(worldPosition, cameraPosition, radius, unfold, ndc)
    element.style.opacity = String(label.opacity * visibility)
  })

  return (
    <Html position={[x, y, z]} pointerEvents="none" zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={elementRef} style={CITY_LABEL_STYLE}>
        {label.feature.name}
      </div>
    </Html>
  )
}

interface CityLabelFieldProps {
  labels: readonly CityLabel[]
  unfold: number
  radius: number
  groupRef: MutableRefObject<THREE.Group | null>
}

function CityLabelField({ labels, unfold, radius, groupRef }: CityLabelFieldProps) {
  return (
    <>
      {labels.map((label) => (
        <CityLabelItem key={label.feature.id} label={label} unfold={unfold} radius={radius} groupRef={groupRef} />
      ))}
    </>
  )
}

// -------------------------------------------------------------------------------- component

export interface HumanCivilisationProps {
  t: GeoTime
  /** `events-core`'s full list — every arrival is one of its entries (ADR-032). */
  effectEvents: readonly TimelineEvent[]
  /** The `cities` `FeatureSet` (ADR-035), or `null` when the layer isn't published. */
  cities: readonly FeatureData[] | null
  unfold: number
  radius: number
  expanded: boolean
  /** The single "Human civilisation" toggle. `false` renders nothing at all. */
  enabled: boolean
  /** `Playback.baseRate` — the timeline's own rate model, the only input to the statically
   *  derived arrival timing (`arrivalTimingFor`). */
  timing: ArrivalTiming
  /** Events whose card is currently in the feed, and the one the viewer is hovering. */
  feedEventIds: ReadonlySet<string>
  hoveredFeedEventId: string | null
  /** The current scene's plotted location, or `null` — never a present-day fallback (ADR-034). */
  sceneMarker: SceneCoordinates | null
  reducedMotion: boolean
  /** Set while a touch press is on one of this layer's targets, so `Globe.tsx`'s orb tap-to-expand
   *  gesture stands down and the tap opens a tooltip instead. */
  touchHitRef: MutableRefObject<boolean>
  /** A new city label's fade window in years, given the city's own first-appearance `t`
   *  (`cities.ts`'s `newCityLabels`, whose own doc comment explains why this arrives as a plain
   *  function rather than an `@/scene` import) — built from real playback pacing
   *  (`Experience.tsx`) so a label's actual on-screen duration is roughly constant everywhere on
   *  the timeline, not a fixed number of years that reads as a minute-long linger in a
   *  scene-dense stretch and a flash in a sparse one. */
  cityLabelFadeWindowAt: (appearanceT: GeoTime) => GeoTime
}

export function HumanCivilisation({
  t,
  effectEvents,
  cities,
  unfold,
  radius,
  expanded,
  enabled,
  timing,
  feedEventIds,
  hoveredFeedEventId,
  sceneMarker,
  reducedMotion,
  touchHitRef,
  cityLabelFadeWindowAt,
}: HumanCivilisationProps) {
  const groupRef = useRef<THREE.Group>(null)
  const candidatesRef = useRef<readonly GlobeHitCandidate[]>([])
  const hovered = useGlobeHitTest({ candidatesRef, unfold, radius, groupRef, enabled, touchHitRef })

  const index = useMemo(() => buildArrivalIndex(effectEvents), [effectEvents])
  const hoveredEventId = hovered?.eventId ?? null
  const tracedIds = useMemo(() => resolveTracedIds(index, hoveredEventId), [index, hoveredEventId])

  // Converts `CITY_DECLUTTER_MIN_SEPARATION_PX` (a screen-pixel budget) into the object-space
  // distance `declutterCities` compares cities by, via the standard perspective scale-at-distance
  // relationship. `useZoomBucket` keeps this from recomputing every frame during a drag/zoom.
  const { camera, size } = useThree()
  const zoomDistance = useZoomBucket(camera, expanded)
  const minSeparationWorldUnits = useMemo(() => {
    const fovYRadians = (((camera as THREE.PerspectiveCamera).fov ?? 40) * Math.PI) / 180
    const pixelsPerWorldUnit = size.height / (2 * zoomDistance * Math.tan(fovYRadians / 2))
    return pixelsPerWorldUnit > 0 ? CITY_DECLUTTER_MIN_SEPARATION_PX / pixelsPerWorldUnit : 0
  }, [camera, size.height, zoomDistance])

  // The orb stays a ranked top-N (decorative, ~130px, room for a handful of dots); expanded draws
  // every city that clears the era-relative significance floor and the screen-space declutter
  // (`cities.ts`'s `citySignificanceFloorAt`/`declutterCities`) — see `CITY_LIMIT_ORB` for why a
  // fixed-size rank cull is wrong there.
  const visibleCities = useMemo(() => {
    if (cities === null) return []
    if (!expanded) return selectCities(cities, t, CITY_LIMIT_ORB)
    const all = allCitiesAt(cities, t)
    return declutterCities(all, (city) => cityLocalPosition(city.feature, unfold), minSeparationWorldUnits)
  }, [cities, t, expanded, unfold, minSeparationWorldUnits])
  // A brief name tag for a city that just appeared — expanded only; the orb never has
  // visibleCities. `newCityLabels` ranks by how recently each city appeared, so the cap falls on
  // the least-recent arrivals rather than the smallest ones.
  const cityLabels = useMemo(
    () => (expanded ? newCityLabels(visibleCities, t, cityLabelFadeWindowAt) : []),
    [expanded, visibleCities, t, cityLabelFadeWindowAt],
  )

  const arrivals = useMemo(
    () => index.records.map((record) => ({ record, presentation: arrivalPresentationAt(record.effect, t, timing) })),
    [index, t, timing],
  )

  // Sympathy is read in three places (marker pulse, arc breathe, arc ghost strength); keeping it a
  // single memoised closure is what stops the three drifting into slightly different rules.
  const sympathyFor = useCallback(
    (eventId: string): number =>
      hoveredFeedEventId === eventId ? HOVERED_SYMPATHY : feedEventIds.has(eventId) ? FEED_SYMPATHY : 0,
    [feedEventIds, hoveredFeedEventId],
  )

  const markers = useMemo(() => {
    const out: GlobeMarker[] = []
    for (const { record, presentation } of arrivals) {
      const traced = tracedIds.has(record.eventId)
      const pulse = Math.max(sympathyFor(record.eventId), traced ? 1 : 0)
      const { destination } = record.effect

      if (presentation.arcAlpha > 0 && presentation.travelling) {
        out.push({
          id: `arrival:${record.eventId}`,
          lat: destination.lat,
          lon: destination.lon,
          radiusPx: ARRIVAL_RING_RADIUS_PX,
          color: ARRIVAL_RGB,
          alpha: 0.55 * presentation.arcAlpha,
          innerFraction: 0.62,
          pulse,
        })
      }
      if (presentation.settleProgress > 0 && presentation.settleProgress < 1) {
        const p = presentation.settleProgress
        out.push({
          id: `ripple:${record.eventId}`,
          lat: destination.lat,
          lon: destination.lon,
          radiusPx: ARRIVAL_RING_RADIUS_PX * (1 + (RIPPLE_MAX_SCALE - 1) * p),
          color: ARRIVAL_RGB,
          alpha: (1 - p) * 0.85,
          innerFraction: 0.78,
          pulse: 0,
        })
      }
      if (presentation.inhabited > 0) {
        out.push({
          id: `inhabited:${record.eventId}`,
          lat: destination.lat,
          lon: destination.lon,
          radiusPx: INHABITED_RADIUS_PX,
          color: INHABITED_RGB,
          alpha: 0.85 * presentation.inhabited,
          innerFraction: 0,
          pulse,
        })
      }
    }

    for (const city of visibleCities) {
      out.push({
        id: `city:${city.feature.id}`,
        lat: city.feature.lat,
        lon: city.feature.lon,
        radiusPx: city.radiusPx,
        color: CITY_RGB,
        // `trailingFade` (cities.ts) fades a marker out over CITY_TRAILING_GRACE_T years past its
        // own newest attested reading, rather than popping it away the instant it's excluded —
        // see CITY_TRAILING_GRACE_T's own doc comment.
        alpha: CITY_ALPHA * city.trailingFade,
        innerFraction: 0,
        pulse: 0,
      })
    }

    if (sceneMarker !== null) {
      out.push({
        id: 'scene-location',
        lat: sceneMarker.lat,
        lon: sceneMarker.lon,
        radiusPx: SCENE_MARKER_RADIUS_PX,
        color: SCENE_RGB,
        alpha: 0.95,
        innerFraction: 0,
        pulse: 0,
      })
      // The location indicator: a ring around the dot, breathing on the same wall-clock pulse
      // every other sympathetic highlight in this layer uses. It appears when a scene with a
      // place becomes current and goes when that scene does — a consequence of `t`, never of a
      // timer, so nothing here hides on inactivity. Reduced motion gets the ring without the
      // breathe rather than a slowed-down one.
      out.push({
        id: 'scene-location-ring',
        lat: sceneMarker.lat,
        lon: sceneMarker.lon,
        radiusPx: SCENE_MARKER_RADIUS_PX * SCENE_RING_SCALE,
        color: SCENE_RGB,
        alpha: 0.7,
        innerFraction: 0.82,
        pulse: reducedMotion ? 0 : 1,
      })
    }
    return out
  }, [arrivals, visibleCities, sceneMarker, tracedIds, sympathyFor, reducedMotion])

  useEffect(() => {
    // Geometry only — id/points/tolerance, needed by `pickCandidate`'s scoring on every pointer
    // move. `content` below defers the title/description/dateRange formatting
    // (`arrivalTarget`/`cityTarget`) until a candidate actually wins a hit test, which is the
    // only time any of that text is read (`GlobeTooltip.tsx`'s own doc comment on `content`).
    // This effect still reruns every frame — `arrivals`/`visibleCities` are fresh arrays each `t`
    // — but building a closure per candidate is cheap; formatting up to ~280 date ranges and
    // population counts every frame is not.
    const candidates: GlobeHitCandidate[] = []
    for (const { record, presentation } of arrivals) {
      if (presentation.arcAlpha > 0 && !record.geometry.isDegenerate) {
        for (const segment of record.geometry.segments) {
          candidates.push({
            content: () => arrivalTarget(record, 'arrival'),
            points: segment,
            tolerancePx: ARC_TOLERANCE_PX,
            sphereLift: ARC_SPHERE_LIFT,
            mapLift: ARC_MAP_LIFT,
          })
        }
      }
      if (presentation.inhabited > 0.2) {
        candidates.push({
          content: () => arrivalTarget(record, 'inhabited'),
          points: [record.effect.destination],
          tolerancePx: MARKER_TOLERANCE_PX,
          sphereLift: MARKER_SPHERE_LIFT,
          mapLift: MARKER_MAP_LIFT,
        })
      }
    }
    for (const city of visibleCities) {
      candidates.push({
        content: () => cityTarget(city, t),
        points: [{ lat: city.feature.lat, lon: city.feature.lon }],
        tolerancePx: MARKER_TOLERANCE_PX,
        sphereLift: MARKER_SPHERE_LIFT,
        mapLift: MARKER_MAP_LIFT,
      })
    }
    candidatesRef.current = candidates
  }, [arrivals, visibleCities, t])

  if (!enabled) return null

  return (
    <group ref={groupRef}>
      {arrivals.map(({ record, presentation }) => {
        const traced = tracedIds.has(record.eventId)
        const alpha = Math.max(presentation.arcAlpha, traced ? TRACE_GHOST_ALPHA : 0)
        if (alpha <= 0 || record.geometry.isDegenerate) return null
        const color = presentation.arcAlpha > 0 ? ARC_COLOR : ARC_GHOST_COLOR
        const sympathy = Math.max(sympathyFor(record.eventId), traced ? 0.6 : 0)
        // The arrowhead fades with the arc it belongs to, never outliving it, and fades in over its
        // own short opening stretch of travel rather than popping in at full strength the instant
        // travel begins (`ARROW_FADE_IN_PROGRESS`'s own doc comment).
        const arrowPlacement = arrowheadPlacementAt(record.effect, presentation.travelProgress)
        const arrowAlpha = alpha * easeSmoothstep(0, ARROW_FADE_IN_PROGRESS, presentation.travelProgress)
        return (
          <group key={record.eventId}>
            {record.geometry.segments.map((points, i) => (
              <ArcSegment
                key={i}
                points={points}
                color={color}
                alpha={alpha}
                reveal={presentation.travelProgress}
                sympathy={sympathy}
                unfold={unfold}
              />
            ))}
            {arrowPlacement !== null && arrowAlpha > 0 && (
              <ArrowHead placement={arrowPlacement} color={color} alpha={arrowAlpha} unfold={unfold} />
            )}
          </group>
        )
      })}
      <MarkerField markers={markers} unfold={unfold} radius={radius} capacity={MARKER_CAPACITY} />
      {cityLabels.length > 0 && <CityLabelField labels={cityLabels} unfold={unfold} radius={radius} groupRef={groupRef} />}
      <GlobeTooltip
        target={hovered}
        unfold={unfold}
        radius={radius}
        sphereLift={MARKER_SPHERE_LIFT}
        mapLift={MARKER_MAP_LIFT}
      />
    </group>
  )
}
