/**
 * Pure geometry for the pole orientation cue drawn over the globe (`Globe.tsx`'s
 * `PoleAxisMarkers`). No three.js, no React — unit-testable without a WebGL context, the same
 * convention `blend.ts` and `effects/math.ts` follow.
 *
 * The 3D axis stub needs no logic here: it's real depth-tested geometry, so the sphere's depth
 * buffer hides it on the far side. The "N"/"S" label does, because it's a DOM overlay
 * (`@react-three/drei`'s `Html`), not depth-tested geometry — that's what `isPoleVisible` is for.
 * Screen *projection* is deliberately not reimplemented: `Html` already does it from the live
 * camera each frame, and hand-rolling it would risk drifting from three.js's perspective math.
 */

export type PoleId = 'N' | 'S'

/**
 * The pole's position on the unit sphere, in the globe's object space. `shaders.ts`'s uv formula
 * (`v = 0.5 - asin(n.y) / PI`, with `texture.flipY = false` on load) lands `v = 0` — the source
 * PNG's top row, north on every equirectangular paleogeography texture — at `n.y = 1`, so `+Y`
 * is the geographic north pole.
 *
 * This is also each pole's fixed *world* position: auto-rotate only mutates the mesh's
 * `rotation.y` and the mesh is never translated, so a point on the Y axis never moves — the
 * sphere's spin never shifts a pole on screen, only camera drag (`OrbitControls`) does.
 */
export function poleDirection(pole: PoleId): readonly [number, number, number] {
  return pole === 'N' ? [0, 1, 0] : [0, -1, 0]
}

/** The label stays hidden until the camera clears the sphere's silhouette by this margin (a
 *  cosine of the horizon angle — see `isPoleVisible`), so it fades out a beat before the
 *  sphere's own edge would clip it, instead of flickering exactly at the boundary. */
export const POLE_VISIBILITY_MARGIN = 0.03

/**
 * Whether `pole` sits on the sphere's camera-facing hemisphere — the self-occlusion a depth
 * buffer resolves for real geometry, computed directly because the label is DOM.
 *
 * Derivation: a point `P` on the sphere (`|P| = sphereRadius`) faces camera `C` iff the outward
 * normal at `P` has a non-negative component along `C - P`: `dot(C - P, P) >= 0`, which (since
 * `dot(P, P) = sphereRadius²`) simplifies to `dot(C, P) >= sphereRadius²`, i.e.
 * `cos(θ) >= sphereRadius / |C|`. `POLE_VISIBILITY_MARGIN` tightens the bound so the label hides
 * just before the true horizon.
 */
export function isPoleVisible(
  pole: PoleId,
  cameraPosition: readonly [number, number, number],
  sphereRadius: number,
): boolean {
  const [dx, dy, dz] = poleDirection(pole)
  const [cx, cy, cz] = cameraPosition
  const cameraDistance = Math.hypot(cx, cy, cz)
  if (cameraDistance === 0) return false
  // |poleDirection| = 1, so this is exactly cos(θ) between cameraPosition and the pole.
  const cosAngle = (dx * cx + dy * cy + dz * cz) / cameraDistance
  return cosAngle > sphereRadius / cameraDistance + POLE_VISIBILITY_MARGIN
}
