/**
 * The globe mesh's grid (docs/GLOBE.md §10): a plain (widthSegments+1) x
 * (heightSegments+1) lon/lat grid carrying a single `aLonLat` (vec2, degrees) attribute — no
 * `position` or `normal` attribute at all. `GLOBE_VERTEX_SHADER` (`shaders.ts`) computes both
 * the sphere and Equal Earth positions per vertex from `aLonLat` via `projection.ts`'s GLSL twin
 * and mixes them by `uUnfold`, so this grid never needs a precomputed position of its own; the
 * split between the pure grid math (`buildGlobeGrid`, tested below without three.js or WebGL)
 * and the thin `THREE.BufferGeometry` wrapper (`buildGlobeGeometry`) mirrors `blend.ts`'s own
 * "pure core, thin three.js/React consumer" split.
 *
 * The seam: columns run lon -180 -> +180 *inclusive* (`widthSegments + 1` columns), the same
 * closing convention `THREE.SphereGeometry` uses. No face connects the last column back to the
 * first, so the two seam columns — coincident on the sphere, but the map's left and right edges
 * once unfolded — move apart as `uUnfold` rises instead of stretching one triangle across the
 * whole map. This matters for *geometry* here, not just UV as on a sphere: a flattened point is
 * a real position that two "same point on the sphere" vertices can legitimately disagree about.
 *
 * The poles: `THREE.SphereGeometry` skips one triangle per quad on its top and bottom rows,
 * which are zero-area on a sphere. This grid keeps them, because Equal Earth flattens each pole
 * to a *line*, not a point — that row is a real edge once `uUnfold` rises, and omitting its
 * triangles would leave a hole along the map's top/bottom edge. At `uUnfold = 0` they are
 * simply zero-area.
 */

import * as THREE from 'three'

export const GLOBE_WIDTH_SEGMENTS = 128
export const GLOBE_HEIGHT_SEGMENTS = 64

export interface GlobeGrid {
  /** `(lon, lat)` pairs in degrees, row-major (`(widthSegments + 1)` columns per row), flattened. */
  lonLat: Float32Array
  indices: Uint32Array
  widthSegments: number
  heightSegments: number
}

/**
 * Pure vertex/index construction — no three.js dependency, so it's unit-testable without a
 * `BufferGeometry`. Mirrors `THREE.SphereGeometry`'s own triangle winding exactly (traced from
 * its source: for corners `a = (iy, ix+1)`, `b = (iy, ix)`, `c = (iy+1, ix)`, `d = (iy+1, ix+1)`,
 * it pushes `(a, b, d)` then `(b, c, d)`).
 *
 * This winding is outward-facing only when paired with the matching position formula: it needs
 * `projection.ts`'s `lonLatToSphere` to keep `z = -cos(lat)*sin(lon)`. Unnegate that `z` and
 * every triangle faces the sphere's centre instead, showing a mirrored Earth. The two must not
 * drift apart; `globeGeometry.test.ts`'s "triangle winding faces outward" checks it numerically
 * (each triangle's edge cross product against the outward radius) rather than by analogy.
 */
export function buildGlobeGrid(widthSegments = GLOBE_WIDTH_SEGMENTS, heightSegments = GLOBE_HEIGHT_SEGMENTS): GlobeGrid {
  const columns = widthSegments + 1
  const rows = heightSegments + 1
  const lonLat = new Float32Array(columns * rows * 2)

  let cursor = 0
  for (let iy = 0; iy < rows; iy++) {
    const lat = 90 - (iy / heightSegments) * 180
    for (let ix = 0; ix < columns; ix++) {
      const lon = -180 + (ix / widthSegments) * 360
      lonLat[cursor++] = lon
      lonLat[cursor++] = lat
    }
  }

  const indices: number[] = []
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * columns + (ix + 1)
      const b = iy * columns + ix
      const c = (iy + 1) * columns + ix
      const d = (iy + 1) * columns + (ix + 1)
      indices.push(a, b, d, b, c, d)
    }
  }

  return { lonLat, indices: Uint32Array.from(indices), widthSegments, heightSegments }
}

/** Wraps `buildGlobeGrid` into a `THREE.BufferGeometry` with only the `aLonLat` attribute —
 *  `Globe.tsx` renders the mesh with `frustumCulled={false}` rather than supplying a `position`
 *  attribute purely for bounding-sphere purposes (the globe is always on screen near the origin;
 *  there is nothing for frustum culling to usefully skip). */
export function buildGlobeGeometry(widthSegments = GLOBE_WIDTH_SEGMENTS, heightSegments = GLOBE_HEIGHT_SEGMENTS): THREE.BufferGeometry {
  const grid = buildGlobeGrid(widthSegments, heightSegments)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('aLonLat', new THREE.BufferAttribute(grid.lonLat, 2))
  geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1))
  return geometry
}
