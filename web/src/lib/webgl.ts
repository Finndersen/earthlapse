/** Feature detection for WebGL renderers. Not pure (touches the DOM) and not part of any
 *  `t -> pixels` contract: a one-shot capability check, read once per mount. Shared by every
 *  package with a react-three-fiber `<Canvas>` mount (`scene`, `globe`, `layers`' ancestor
 *  portrait) so none of them needs to import another's internals just for this check. */
export function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
  } catch {
    return false
  }
}
