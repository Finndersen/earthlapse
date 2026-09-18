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
 * **The seam.** Columns run lon -180 -> +180 *inclusive* (`widthSegments + 1` columns, not
 * `widthSegments`) — the same closing convention `THREE.SphereGeometry` itself uses (its own
 * `widthSegments + 1` columns, phi 0 -> 2*PI). No face ever connects the last column back to the
 * first (the index loop below only ever joins column `ix` to `ix + 1`, `ix < widthSegments`), so
 * the two seam columns — coincident on the sphere (same meridian, ±180° apart is the same great
 * circle) but the map's *left and right edges* once unfolded — simply move apart as `uUnfold`
 * rises instead of one enormous triangle stretching across the whole map. This is exactly how
 * `THREE.SphereGeometry` already avoids a texture-seam artefact on the sphere; the difference
 * here is that keeping it now also matters for *geometry*, not just UV, because a flattened
 * point is no longer just a UV coordinate on a continuous surface — it is a real position that
 * two "same point on the sphere" vertices can legitimately disagree about.
 *
 * **The poles.** `THREE.SphereGeometry` skips one of the two triangles per quad at its very top
 * and bottom row (`iy === 0`/`iy === heightSegments - 1`), since those triangles are exactly
 * zero-area on a sphere (the whole row collapses to one point) and not worth rendering. This
 * grid does *not* skip them: Equal Earth flattens each pole to a *line*, not a point, so that
 * same row is a real, non-degenerate edge once `uUnfold` rises — omitting its triangles would
 * leave a hole along the top/bottom edge of the unfolded map. At `uUnfold = 0` those triangles
 * are simply zero-area, the same harmless cost `THREE.SphereGeometry` accepts everywhere else.
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
 * **This winding is only outward-facing when paired with the right position formula.** An
 * earlier version of `projection.ts`'s `lonLatToSphere` used an unnegated `z`, which pairs this
 * exact winding with inward-facing normals instead — every triangle faced the sphere's own
 * centre, so the camera saw the inside of the back hemisphere through the front: a mirrored
 * Earth (east on the left) with dimmer lighting (the front-facing normals pointed away from the
 * camera, not toward it). `lonLatToSphere`'s current `z = -cos(lat)*sin(lon)` is specifically
 * the sign this winding needs to face outward — verified numerically in
 * `globeGeometry.test.ts`'s "triangle winding faces outward" (cross product of each triangle's
 * edges compared against the outward radius direction, not just asserted by analogy to
 * `THREE.SphereGeometry`, which is what let this bug ship the first time).
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
