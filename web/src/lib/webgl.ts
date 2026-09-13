/** Feature detection for WebGL renderers. Not pure (touches the DOM) and not part of any
 *  `t -> pixels` contract: a one-shot capability check, read once per mount. Same check as
 *  `scene/webgl.ts`, shared here so the layers package need not import the scene package. */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
  } catch {
    return false
  }
}
