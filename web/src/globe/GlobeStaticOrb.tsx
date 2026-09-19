'use client'

/**
 * Fallback for `<Globe>` when WebGL is unavailable (`supportsWebGL()`, `@/lib/webgl`): a plain
 * gradient orb in place of the `<Canvas>` sphere, so the globe keeps its place in the shell
 * (`Globe.tsx`'s surrounding chrome is unchanged either way). Decorative, like the sphere it
 * replaces — the caption `Globe.tsx` reports through `onCaptionChange` carries the information.
 */

import styles from './Globe.module.css'

export function GlobeStaticOrb() {
  return <div className={styles.staticOrb} data-testid="globe-static-orb" aria-hidden="true" />
}
