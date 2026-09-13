'use client'

/**
 * `<AncestorPortrait layer t assetBase />` — the ancestor's specimen plate, morphing into the
 * next as `t` crosses a divergence (ADR-015, VISUAL_SPEC §10). Round and feathered, sized for
 * the lens HUD's top-right ancestor slot above `<AncestorReadout>`, which carries the words;
 * the plate itself is decorative and hidden from assistive technology.
 *
 * The target (`layer.sample(t).portrait`) is pure in `t`. What is displayed is rate-limited
 * toward it by `usePresentedMix`, so a full morph never shows in under
 * `MIN_PORTRAIT_TRANSITION_SECONDS`. WebGL warps the plates along their flow fields; without
 * WebGL, or for a pair with no computed morph, the plates crossfade. Renders nothing when the
 * lineage has no portrait at `t`.
 */

import { useMemo } from 'react'

import { resolveAssetUrl } from '@/lib/assetUrl'
import { usePresentedMix } from '@/lib/presentedMix'
import { supportsWebGL } from '@/lib/webgl'
import type { GeoTime, Layer, NodeValue, PortraitMix } from '@/types/layer'

import { MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING, portraitDrawState, portraitEase } from '../portraits'
import styles from './hud.module.css'
import { PortraitCanvas, type PortraitFlow } from './PortraitCanvas'

export interface AncestorPortraitProps {
  layer: Layer<NodeValue>
  t: GeoTime
  assetBase: string
}

export function AncestorPortrait({ layer, t, assetBase }: AncestorPortraitProps) {
  const target = layer.sample(t)?.portrait
  if (target === undefined) return null
  return <PresentedPortrait target={target} assetBase={assetBase} />
}

function PresentedPortrait({ target, assetBase }: { target: PortraitMix; assetBase: string }) {
  const webgl = useMemo(() => supportsWebGL(), [])
  const presented = usePresentedMix(target, MIN_PORTRAIT_TRANSITION_SECONDS, PORTRAIT_MIX_KEYING)
  const draw = portraitDrawState(presented)
  const alpha = portraitEase(draw.alpha)
  const olderUrl = resolveAssetUrl(assetBase, draw.older.image)
  const youngerUrl = resolveAssetUrl(assetBase, draw.younger.image)
  const flow: PortraitFlow | null =
    draw.morph === null
      ? null
      : {
          forwardUrl: resolveAssetUrl(assetBase, draw.morph.forward),
          backwardUrl: resolveAssetUrl(assetBase, draw.morph.backward),
          forwardRange: draw.morph.forwardRange,
          backwardRange: draw.morph.backwardRange,
        }

  return (
    <div
      className={styles.portrait}
      aria-hidden="true"
      data-testid="ancestor-portrait"
      data-older={draw.older.nodeId}
      data-younger={draw.younger.nodeId}
      data-transition={flow === null ? 'crossfade' : 'flow'}
    >
      {webgl ? (
        <PortraitCanvas olderUrl={olderUrl} youngerUrl={youngerUrl} flow={flow} alpha={alpha} />
      ) : (
        <>
          <img className={styles.portraitLayer} src={olderUrl} alt="" data-testid="portrait-older" style={{ opacity: 1 }} />
          <img className={styles.portraitLayer} src={youngerUrl} alt="" data-testid="portrait-younger" style={{ opacity: alpha }} />
        </>
      )}
    </div>
  )
}
