/** Whether a throwaway context could be opened at all, and (when it could) its
 *  `MAX_TEXTURE_SIZE` — `globe/deviceTier.ts`'s `supportsBasemapT1` needs the latter to decide
 *  whether a device's GPU can hold the human-era basemap's larger tier, and used to open a
 *  *second* throwaway canvas/context purely to read it (a real, if small, leak: `Globe.tsx`
 *  called both `supportsWebGL()` and `supportsBasemapT1()` on every mount, each opening and
 *  never releasing its own context). `probeWebgl` is the one place that opens a
 *  context to answer both questions, so a caller who needs both never opens two. */
export interface WebglProbe {
  supported: boolean
  /** `0` when no context could be opened at all (mirrors `supported: false`) — never a
   *  meaningful "GPU supports zero-size textures" claim. */
  maxTextureSize: number
}

export function probeWebgl(): WebglProbe {
  if (typeof document === 'undefined') return { supported: false, maxTextureSize: 0 }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (gl === null) return { supported: false, maxTextureSize: 0 }
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    // Proactively frees the context instead of leaving it to whenever the GC gets to the
    // detached canvas — every real WebGL implementation supports this extension; its absence
    // just makes this a no-op, not an error.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return { supported: true, maxTextureSize }
  } catch {
    return { supported: false, maxTextureSize: 0 }
  }
}

/** Feature detection for WebGL renderers. Not pure (touches the DOM) and not part of any
 *  `t -> pixels` contract: a one-shot capability check, read once per mount. Shared by every
 *  package with a react-three-fiber `<Canvas>` mount (`scene`, `globe`, `layers`' ancestor
 *  portrait) so none of them needs to import another's internals just for this check. A caller
 *  that also needs `maxTextureSize` (only `Globe.tsx`, today) should call `probeWebgl()` directly
 *  instead, so the two checks share one context rather than each opening its own. */
export function supportsWebGL(): boolean {
  return probeWebgl().supported
}
