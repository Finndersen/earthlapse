'use client'

/**
 * One instanced billboard field for every dot the human-civilisation layer draws: inhabited
 * markers, city markers, arrival landing ripples and the scene-location indicator. One draw call,
 * one shader, one geometry — not one `<mesh>` (and one `useFrame`) per marker, which does not
 * scale to the full published city set.
 *
 * **Nothing here allocates or computes per frame.** Positions are projected on the GPU through
 * `projection.ts`'s own GLSL twin (so a marker can never drift from the mesh mid-unfold), the
 * screen-space size expansion is the same technique the arc ribbon uses, and the one animated
 * quantity — the sympathetic pulse a marker plays while its event card is on screen, or while it
 * is part of a traced chain — is driven by a `uTime` uniform rather than by JS rewriting buffers.
 * The instance buffers are rewritten only when the *set* of markers changes in content — compared
 * by value (`sameMarkers`), not by the `markers` prop's own array identity, since a fresh array of
 * identical markers is a React render too (every caller of `MarkerField` in this codebase rebuilds
 * `markers` on every `t`, one of the arguments its own values are a pure function of).
 *
 * Markers are depth-tested against the sphere (so the far side is hidden) *and* faded across the
 * limb in the vertex shader, the same belt-and-braces `arcs.ts`'s `sphereMarkerVisibility`
 * documents: a billboard lifted a hair off the surface is ambiguous to depth-testing alone
 * exactly at the silhouette.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { glslFloat } from './glsl'
import { MARKER_MAP_LIFT, MARKER_SPHERE_LIFT } from './humanStyle'
import { PROJECTION_GLSL } from './projection'

/** One dot. Pure data — `HumanCivilisation.tsx` builds these fresh each render from `t`. */
export interface GlobeMarker {
  /** Stable identity, for the caller's own bookkeeping (hit-testing, labels). Not read here. */
  id: string
  lat: number
  lon: number
  /** Outer radius in CSS pixels, so a marker reads the same physical size on the orb, expanded
   *  and on the map, at any zoom and any device pixel ratio. */
  radiusPx: number
  color: readonly [number, number, number]
  alpha: number
  /** Inner radius as a fraction of the outer: 0 draws a filled disc, 0.6 a hollow ring. */
  innerFraction: number
  /** 0 (still) .. 1 (fully pulsing) — a wall-clock breathe in size and brightness, for a marker
   *  whose event card is currently on screen or which is part of a traced chain. */
  pulse: number
}

/** Softness of the disc's own edge, in CSS pixels — converted to a fraction of each marker's own
 *  radius in the vertex shader so a 2px dot and a 9px dot get the same visual crispness. */
const EDGE_SOFTNESS_PX = 1.2
/** How far past the true horizon the limb fade spans, as a fraction of the threshold cosine —
 *  mirrors `arcs.ts`'s own `MARKER_FADE_BAND`. */
const LIMB_FADE_BAND = 0.12
/** Peak size and brightness gain of the sympathetic pulse, and its rate in radians/second. */
const PULSE_SIZE_GAIN = 0.45
const PULSE_ALPHA_GAIN = 0.35
const PULSE_RATE = 4.2

const MARKER_VERTEX_SHADER = /* glsl */ `
attribute vec2 aCorner;
attribute vec2 aLonLat;
attribute float aRadiusPx;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aInner;
attribute float aPulse;

uniform float uUnfold;
uniform float uRadius;
uniform vec2 uResolution;
uniform float uTime;

${PROJECTION_GLSL}

varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vInner;
varying float vSoftness;

void main() {
  float breathe = sin(uTime * ${glslFloat(PULSE_RATE)}) * 0.5 + 0.5;
  float radiusPx = aRadiusPx * (1.0 + ${glslFloat(PULSE_SIZE_GAIN)} * aPulse * breathe);

  vec3 center = unfoldedLiftedPosition(aLonLat, uUnfold, ${glslFloat(MARKER_SPHERE_LIFT)}, ${glslFloat(MARKER_MAP_LIFT)});
  vec4 centerView = modelViewMatrix * vec4(center, 1.0);
  vec4 originView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  // The limb fade, in view space so it needs no separate world-space read: the camera sits at
  // the view-space origin, so the vector from the sphere's centre to the camera is just
  // -originView.xyz. Same derivation as arcs.ts's sphereMarkerVisibility, with the direction
  // properly normalised (the marker's own lift makes it slightly longer than uRadius).
  vec3 toCamera = -originView.xyz;
  float cameraDistance = length(toCamera);
  vec3 direction = normalize(centerView.xyz - originView.xyz);
  float cosAngle = dot(direction, toCamera) / max(cameraDistance, 1e-5);
  float threshold = uRadius / max(cameraDistance, 1e-5);
  float band = ${glslFloat(LIMB_FADE_BAND)};
  float limb = smoothstep(threshold - band, threshold + band, cosAngle);

  vColor = aColor;
  vInner = aInner;
  vAlpha = aAlpha * mix(limb, 1.0, uUnfold) * (1.0 + ${glslFloat(PULSE_ALPHA_GAIN)} * aPulse * breathe);
  vCorner = aCorner;
  vSoftness = ${glslFloat(EDGE_SOFTNESS_PX)} / max(radiusPx, 0.5);

  vec4 clip = projectionMatrix * centerView;
  vec2 offsetNdc = (aCorner * radiusPx / uResolution) * 2.0;
  gl_Position = clip;
  gl_Position.xy += offsetNdc * clip.w;
}
`

/** The dark inner rim is what keeps a bright dot legible over pale desert and a pale dot legible
 *  over dark ocean, without a second draw call for an outline. */
const MARKER_FRAGMENT_SHADER = /* glsl */ `
varying vec2 vCorner;
varying vec3 vColor;
varying float vAlpha;
varying float vInner;
varying float vSoftness;

void main() {
  float d = length(vCorner);
  float outer = 1.0 - smoothstep(1.0 - vSoftness, 1.0, d);
  float inner = vInner > 0.0 ? smoothstep(vInner - vSoftness, vInner + vSoftness, d) : 1.0;
  float alpha = clamp(vAlpha, 0.0, 1.0) * outer * inner;
  if (alpha < 0.004) discard;
  float rim = smoothstep(0.66, 0.99, d);
  gl_FragColor = vec4(vColor * mix(1.0, 0.35, rim * 0.85), alpha);

  #include <colorspace_fragment>
}
`

const CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1])
const CORNER_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3])

/**
 * Content equality for the fields that actually reach the GPU buffers — `id` is included too
 * even though it isn't itself uploaded (see `GlobeMarker.id`'s own doc comment), so a marker set
 * that reorders without changing any drawn value still counts as changed rather than risking a
 * false "unchanged" that would desync a buffer's contents from its own index. Exported for
 * `MarkerField.test.tsx`.
 */
export function sameMarker(a: GlobeMarker, b: GlobeMarker): boolean {
  return (
    a.id === b.id &&
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.radiusPx === b.radiusPx &&
    a.alpha === b.alpha &&
    a.innerFraction === b.innerFraction &&
    a.pulse === b.pulse &&
    a.color[0] === b.color[0] &&
    a.color[1] === b.color[1] &&
    a.color[2] === b.color[2]
  )
}

/** Exported for `MarkerField.test.tsx`. */
export function sameMarkers(a: readonly GlobeMarker[], b: readonly GlobeMarker[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!sameMarker(a[i]!, b[i]!)) return false
  }
  return true
}

interface InstanceBuffers {
  lonLat: THREE.InstancedBufferAttribute
  radiusPx: THREE.InstancedBufferAttribute
  color: THREE.InstancedBufferAttribute
  alpha: THREE.InstancedBufferAttribute
  inner: THREE.InstancedBufferAttribute
  pulse: THREE.InstancedBufferAttribute
}

function buildMesh(capacity: number): { mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; buffers: InstanceBuffers } {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(CORNERS, 2))
  geometry.setIndex(new THREE.BufferAttribute(CORNER_INDICES, 1))
  const buffers: InstanceBuffers = {
    lonLat: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2),
    radiusPx: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    color: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
    alpha: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    inner: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
    pulse: new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  }
  geometry.setAttribute('aLonLat', buffers.lonLat)
  geometry.setAttribute('aRadiusPx', buffers.radiusPx)
  geometry.setAttribute('aColor', buffers.color)
  geometry.setAttribute('aAlpha', buffers.alpha)
  geometry.setAttribute('aInner', buffers.inner)
  geometry.setAttribute('aPulse', buffers.pulse)
  geometry.instanceCount = 0

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uUnfold: { value: 0 },
      uRadius: { value: 1 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    },
    vertexShader: MARKER_VERTEX_SHADER,
    fragmentShader: MARKER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  // Returned alongside the mesh because `Mesh.geometry` is typed as the base `BufferGeometry`,
  // which has no `instanceCount` — keeping the concrete type here beats casting at each use.
  return { mesh, geometry, buffers }
}

export interface MarkerFieldProps {
  markers: readonly GlobeMarker[]
  unfold: number
  /** `GLOBE_RADIUS` — only used for the limb-fade threshold; positions come from the projection's
   *  own radius-1 convention, exactly like the arc ribbon's. */
  radius: number
  /** Instance buffers are allocated once at this size and never grown, so a caller must cap its
   *  own marker count to it. Extra markers beyond the capacity are dropped rather than
   *  reallocating mid-session. */
  capacity: number
}

export function MarkerField({ markers, unfold, radius, capacity }: MarkerFieldProps) {
  const { size } = useThree()
  const { mesh, geometry, buffers } = useMemo(() => buildMesh(capacity), [capacity])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )

  // Paired with `buffers` itself, not a bare `useRef([])`: a `capacity` change swaps in a whole
  // new `buffers` object (fresh, zeroed typed arrays) via the `useMemo` above, and a stale
  // "unchanged" snapshot from the old buffers would then wrongly skip writing the new ones.
  const previousRef = useRef<{ buffers: InstanceBuffers; markers: readonly GlobeMarker[] } | null>(null)

  useEffect(() => {
    const previous = previousRef.current
    if (previous !== null && previous.buffers === buffers && sameMarkers(previous.markers, markers)) return

    const count = Math.min(markers.length, capacity)
    for (let i = 0; i < count; i++) {
      const marker = markers[i]!
      buffers.lonLat.array[i * 2] = marker.lon
      buffers.lonLat.array[i * 2 + 1] = marker.lat
      buffers.radiusPx.array[i] = marker.radiusPx
      buffers.color.array[i * 3] = marker.color[0]
      buffers.color.array[i * 3 + 1] = marker.color[1]
      buffers.color.array[i * 3 + 2] = marker.color[2]
      buffers.alpha.array[i] = marker.alpha
      buffers.inner.array[i] = marker.innerFraction
      buffers.pulse.array[i] = marker.pulse
    }
    for (const attribute of Object.values(buffers)) attribute.needsUpdate = true
    geometry.instanceCount = count
    mesh.visible = count > 0
    previousRef.current = { buffers, markers }
  }, [markers, buffers, geometry, mesh, capacity])

  useFrame((state) => {
    const material = mesh.material as THREE.ShaderMaterial
    material.uniforms.uUnfold!.value = unfold
    material.uniforms.uRadius!.value = radius
    material.uniforms.uTime!.value = state.clock.elapsedTime
    ;(material.uniforms.uResolution!.value as THREE.Vector2).set(size.width, size.height)
  })

  return <primitive object={mesh} />
}
