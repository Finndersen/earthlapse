/**
 * Pure geometry for the pole orientation cue drawn over the globe (`Globe.tsx`'s
 * `PoleAxisMarkers`). No three.js, no React — safe to unit test without a WebGL context, the
 * same convention `blend.ts` and `effects/math.ts` follow for their own pure cores.
 *
 * The 3D axis stub at each pole needs no logic here: it's real depth-tested geometry, so the
 * sphere's own depth buffer hides it correctly when it's on the far side. The "N"/"S" text
 * label does need one — it's a DOM overlay (`@react-three/drei`'s `Html`), not depth-tested
 * geometry — which is what `isPoleVisible` is for. Screen *projection* (where the label lands
 * on screen) is deliberately not reimplemented here: `Html` already does that correctly from
 * the live camera every frame, and hand-rolling it would only risk drifting from three.js's own
 * perspective math for no benefit.
 */

export type PoleId = 'N' | 'S'

/**
 * The pole's position on the unit sphere, in the globe's own object space. `shaders.ts`'s uv
 * formula (`v = 0.5 - asin(n.y) / PI`, combined with `texture.flipY = false` on load) makes
 * `v = 0` — the source PNG's top row, i.e. north on every equirectangular paleogeography texture
 * — land at `n.y = 1`. So `+Y` is the geographic north pole.
 *
 * This is also each pole's fixed *world* position: `Globe.tsx`'s auto-rotate only mutates the
 * mesh's `rotation.y`, which leaves any point already on the Y axis fixed (the mesh is never
 * translated), so the sphere's own spin never moves a pole on screen — only camera drag
 * (`OrbitControls`) does.
 */
export function poleDirection(pole: PoleId): readonly [number, number, number] {
  return pole === 'N' ? [0, 1, 0] : [0, -1, 0]
}

/** The label stays hidden until the camera clears the sphere's silhouette by this margin (a
 *  cosine of the horizon angle — see `isPoleVisible`), so it fades out a beat before the
 *  sphere's own edge would clip it, instead of flickering exactly at the boundary. */
export const POLE_VISIBILITY_MARGIN = 0.03

/**
 * Whether `pole` sits on the hemisphere of a sphere (radius `sphereRadius`, centred at the
 * origin) that faces a camera at `cameraPosition` — the same self-occlusion a depth buffer
 * would resolve for real geometry there, computed directly since the pole label is DOM, not
 * depth-tested geometry.
 *
 * Derivation: a point `P` on the sphere (`|P| = sphereRadius`) is on the hemisphere facing
 * camera `C` iff the ray from `P` to `C` doesn't point back into the sphere — i.e. the outward
 * surface normal at `P` (`P / sphereRadius`) has a non-negative component along `C - P`:
 * `dot(C - P, P) >= 0`, which simplifies (`dot(P, P) = sphereRadius²`) to
 * `dot(C, P) >= sphereRadius²`, or in terms of the angle `θ` between `C` and `P`:
 * `cos(θ) >= sphereRadius / |C|`. `POLE_VISIBILITY_MARGIN` tightens that bound slightly so the
 * label hides a little before the true horizon.
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
