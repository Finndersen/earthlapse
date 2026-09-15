'use client'

/**
 * Fallback for `<Globe>` when WebGL is unavailable (`supportsWebGL()`, `@/lib/webgl`): a plain
 * gradient orb standing in for the `<Canvas>` sphere. No raster data, rotation, regimes or
 * overlay effects — it exists only so the globe keeps its place in the shell (the surrounding
 * `.orb`/`.orbExpanded`/`.halo`/expand-collapse chrome in `Globe.tsx` is unchanged either way).
 * Decorative, like the WebGL sphere it replaces — the caption slot Globe.tsx reports through
 * `onCaptionChange` still carries the actual information.
 */

import styles from './Globe.module.css'

export function GlobeStaticOrb() {
  return <div className={styles.staticOrb} data-testid="globe-static-orb" aria-hidden="true" />
}
