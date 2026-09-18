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
 * a canvas). Three things animate on wall-clock time and none of them decides *what* is on
 * screen, only how it moves: the pulse travelling along an arc in flight, the sympathetic breathe
 * of a marker or arc whose event card is showing, and the scene-location ring's own breathe.
 * Scrubbing to a given `t` from either direction reproduces exactly the same set of drawables at
 * the same strengths.
 *
 * **One instanced field, not one mesh per dot.** Every marker — arrival ring, landing ripple,
 * inhabited, city, scene location — is an instance in a single `MarkerField`, so forty-five cities cost one draw call
 * and zero per-frame JS. Arcs stay individual meshes because each is its own ribbon geometry, but
 * only the handful actually in flight (or ghosted by a trace) render at all, where the previous
 * implementation drew all twenty-five permanently.
 *
 * **Labels.** City names appear on hover, in the shared tooltip, and not as drawn labels — the
 * same call ADR-032 recorded for arrival labels, for the same reason: at globe scale the labelled
 * set overlaps constantly, and a screen-space collision cull that silently drops half of them is
 * worse than a tooltip that always answers.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'

import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { FeatureData, GeoTime, TimelineEvent } from '@/types/layer'
import type { SceneCoordinates } from '@/types/manifest'

import {
  arrivalPresentationAt,
  arrivalWindow,
  buildArrivalIndex,
  buildFatLineBuffers,
  traceToOrigin,
  type ArrivalRecord,
  type ArrivalTiming,
  type DistancedAnchor,
} from './arcs'
import { CITY_LIMIT_EXPANDED, CITY_LIMIT_ORB, cityEstimateRange, selectCities, type CityAtTime } from './cities'
import { srgbHexToLinear } from './color'
import { GlobeTooltip, useGlobeHitTest, type GlobeHitCandidate, type GlobeHitTarget } from './GlobeTooltip'
import { glslFloat } from './glsl'
import {
  ARC_MAP_LIFT,
  ARC_SPHERE_LIFT,
  ARRIVAL_COLOR,
  ARRIVAL_GHOST_COLOR,
  ARRIVAL_PULSE_COLOR,
  CITY_COLOR,
  INHABITED_COLOR,
  MARKER_MAP_LIFT,
  MARKER_SPHERE_LIFT,
  SCENE_LOCATION_COLOR,
} from './humanStyle'
import { MarkerField, type GlobeMarker } from './MarkerField'
import { PROJECTION_GLSL } from './projection'

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
 * The arc's own colour is flat; everything that moves along it is additive light.
 *
 * `uTravelling` gates a bright head that runs `origin -> destination` on a wall-clock loop — the
 * one place this layer deliberately does *not* read `t`. A migration's dating uncertainty is
 * often a thousandth of the arc's own on-screen life, so driving the head from `t` would make it
 * a single invisible frame at one playback speed and a crawl at another; looping it instead means
 * the direction of travel reads at every speed, including paused. What `t` decides is whether the
 * head runs at all, and how strongly the arc is drawn.
 *
 * `uSympathy` is the same idea for the event feed: while an arrival's card is on screen (stronger
 * while the viewer hovers it) its arc breathes, so card and globe are visibly the same subject.
 */
const ARC_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uPulseColor;
uniform float uAlpha;
uniform float uTravelling;
uniform float uSympathy;
uniform float uTime;
varying float vDistance;

const float HEAD_SECONDS = 1.6;
const float HEAD_WIDTH = 0.1;
const float TRAIL_WIDTH = 0.34;

void main() {
  float head = fract(uTime / HEAD_SECONDS);
  float behind = head - vDistance;
  float trail = behind >= 0.0 ? exp(-behind / TRAIL_WIDTH) : 0.0;
  float core = exp(-abs(behind) * abs(behind) / (HEAD_WIDTH * HEAD_WIDTH));
  float pulse = uTravelling * max(core, trail * 0.45);

  float breathe = sin(uTime * 4.2) * 0.5 + 0.5;
  float alpha = clamp(uAlpha * (1.0 + 0.45 * uSympathy * breathe), 0.0, 1.0);
  vec3 color = mix(uColor, uPulseColor, clamp(pulse, 0.0, 1.0));

  gl_FragColor = vec4(color, clamp(alpha + pulse * 0.5 * uAlpha, 0.0, 1.0));

  #include <colorspace_fragment>
}
`

/** Half-width in CSS pixels — ~2.6px total width. */
const ARC_HALF_WIDTH_PX = 1.3

const ARC_COLOR = new THREE.Color(...srgbHexToLinear(ARRIVAL_COLOR))
const ARC_PULSE_COLOR = new THREE.Color(...srgbHexToLinear(ARRIVAL_PULSE_COLOR))
const ARC_GHOST_COLOR = new THREE.Color(...srgbHexToLinear(ARRIVAL_GHOST_COLOR))

interface ArcSegmentProps {
  points: readonly DistancedAnchor[]
  color: THREE.Color
  alpha: number
  travelling: boolean
  sympathy: number
  unfold: number
}

function ArcSegment({ points, color, alpha, travelling, sympathy, unfold }: ArcSegmentProps) {
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
        uPulseColor: { value: ARC_PULSE_COLOR },
        uAlpha: { value: 0 },
        uTravelling: { value: 0 },
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
    material.uniforms.uTravelling!.value = travelling ? 1 : 0
    material.uniforms.uSympathy!.value = sympathy
    material.uniforms.uTime!.value = state.clock.elapsedTime
    ;(material.uniforms.uResolution!.value as THREE.Vector2).set(size.width, size.height)
  })

  return <primitive object={mesh} frustumCulled={false} />
}

// ---------------------------------------------------------------------------------- markers

const INHABITED_RGB = srgbHexToLinear(INHABITED_COLOR)
const ARRIVAL_RGB = srgbHexToLinear(ARRIVAL_COLOR)
const CITY_RGB = srgbHexToLinear(CITY_COLOR)
const SCENE_RGB = srgbHexToLinear(SCENE_LOCATION_COLOR)

/** Instance budget: 25 arrivals may each contribute a destination ring and a landing ripple, 45
 *  cities may be drawn expanded, and the scene location adds a dot plus its pulse ring. Rounded
 *  up to leave headroom for a longer curated arrival set without a reallocation. */
const MARKER_CAPACITY = 128

const INHABITED_RADIUS_PX = 3.4
const ARRIVAL_RING_RADIUS_PX = 4.2
const RIPPLE_MAX_SCALE = 4
const SCENE_MARKER_RADIUS_PX = 4.5
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

function cityTarget(city: CityAtTime, t: GeoTime): GlobeHitTarget {
  const [newest, oldest] = cityEstimateRange(city.feature)
  return {
    kind: 'city',
    id: `city:${city.feature.id}`,
    eventId: null,
    title: city.feature.name,
    description: `${city.feature.country} · about ${formatPopulation(city.population)} people at ${formatGeoTime(t)}`,
    dateRange: `Recorded ${formatTimeRange([newest, oldest])}`,
    anchor: { lat: city.feature.lat, lon: city.feature.lon },
  }
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
}: HumanCivilisationProps) {
  const groupRef = useRef<THREE.Group>(null)
  const candidatesRef = useRef<readonly GlobeHitCandidate[]>([])
  const hovered = useGlobeHitTest({ candidatesRef, unfold, radius, groupRef, enabled, touchHitRef })

  const index = useMemo(() => buildArrivalIndex(effectEvents), [effectEvents])
  const tracedIds = useMemo(() => {
    const source = hovered !== null && hovered.eventId !== null ? hovered.eventId : null
    return source === null ? new Set<string>() : new Set(traceToOrigin(index, source))
  }, [hovered, index])

  const cityLimit = expanded ? CITY_LIMIT_EXPANDED : CITY_LIMIT_ORB
  const visibleCities = useMemo(
    () => (cities === null ? [] : selectCities(cities, t, cityLimit)),
    [cities, t, cityLimit],
  )

  const arrivals = useMemo(
    () => index.records.map((record) => ({ record, presentation: arrivalPresentationAt(record.effect, t, timing) })),
    [index, t, timing],
  )

  // Sympathy is read in three places (marker pulse, arc pulse, arc ghost strength); keeping it a
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
        alpha: 0.92,
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
    const candidates: GlobeHitCandidate[] = []
    for (const { record, presentation } of arrivals) {
      if (presentation.arcAlpha > 0 && !record.geometry.isDegenerate) {
        for (const segment of record.geometry.segments) {
          candidates.push({
            target: arrivalTarget(record, 'arrival'),
            points: segment,
            tolerancePx: ARC_TOLERANCE_PX,
            sphereLift: ARC_SPHERE_LIFT,
            mapLift: ARC_MAP_LIFT,
          })
        }
      }
      if (presentation.inhabited > 0.2) {
        candidates.push({
          target: arrivalTarget(record, 'inhabited'),
          points: [record.effect.destination],
          tolerancePx: MARKER_TOLERANCE_PX,
          sphereLift: MARKER_SPHERE_LIFT,
          mapLift: MARKER_MAP_LIFT,
        })
      }
    }
    for (const city of visibleCities) {
      candidates.push({
        target: cityTarget(city, t),
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
        return (
          <group key={record.eventId}>
            {record.geometry.segments.map((points, i) => (
              <ArcSegment
                key={i}
                points={points}
                color={color}
                alpha={alpha}
                travelling={presentation.travelling && presentation.arcAlpha > 0}
                sympathy={sympathy}
                unfold={unfold}
              />
            ))}
          </group>
        )
      })}
      <MarkerField markers={markers} unfold={unfold} radius={radius} capacity={MARKER_CAPACITY} />
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
