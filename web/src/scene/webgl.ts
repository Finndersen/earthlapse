/** Feature detection for the WebGL scene renderer. Not pure (touches the DOM) and not part of
 *  the `t -> pixels` contract — a one-shot capability check, read once per mount. */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
  } catch {
    return false
  }
}
