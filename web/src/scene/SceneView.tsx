'use client'

/**
 * `<SceneView>` — the flat-still cross-dissolve scene viewport (DESIGN §5 v1 note / ADR-009).
 *
 * Two stacked, persistent `<img>` layers: `from` fixed at opacity 1, `to` at `sceneAt`'s
 * `mix`. Never both faded at once — `from`'s opacity is hardcoded, not derived from `mix`.
 * Each layer decodes its next image off-DOM before swapping to it, and keeps showing its
 * last decoded image while the next one decodes, so scrubbing never shows a blank frame.
 * The scene immediately before/after the current pair is preloaded speculatively.
 *
 * Prop-driven and pure in `t`: no store import, matches DESIGN §10 / the Layer convention.
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react'

import type { GeoTime } from '@/types/layer'
import type { Chapter, Scene } from '@/types/manifest'

import { dominantScene, resolveAssetUrl, sceneAt } from './scene'

export interface SceneViewProps {
  t: GeoTime
  /** Sorted ascending by `t` — see `sceneAt`. */
  scenes: Scene[]
  chapters: Chapter[]
  assetBase: string
  /** Renders the caption for whichever of the current pair is dominant (`dominantScene`).
   *  Positioning and styling are entirely the returned node's — SceneView applies none. */
  renderCaption?: (scene: Scene) => ReactNode
  className?: string
}

/** URLs this browser session has confirmed decode cleanly. Shared by both layers of every
 *  `SceneView` instance: an image only ever needs decoding once, and sharing the cache is
 *  what lets the base layer pick up a scene the overlay already decoded a moment ago (see
 *  `useDecodedSrc`) instead of redoing the work and lagging a render behind. Only ever grows;
 *  images are immutable content at a given URL, so nothing needs to invalidate it. */
const decodedUrls = new Set<string>()

/** Holds the last fully decoded image URL for one layer, and advances to a new target URL
 *  only once it has decoded — so the DOM never shows a half-loaded frame. When the target is
 *  already a known-decoded URL, the swap happens synchronously during render (the React
 *  "adjust state during rendering" pattern) rather than via an effect. That matters here: the
 *  overlay's opacity (`mix`) is driven straight off `t` and updates the instant the pair
 *  changes, but a scene often flips from being the overlay to being the base (or vice versa)
 *  at the very boundary where `mix` resets to 0. If the base's identity only caught up on the
 *  next effect tick, that one render in between would show the *old* base at opacity 1 under
 *  an overlay whose opacity has already collapsed toward 0 — a one-frame flash back to the
 *  wrong scene. Consulting the shared cache during render closes that gap. */
function useDecodedSrc(targetUrl: string): string {
  const [displayed, setDisplayed] = useState(targetUrl)

  if (targetUrl !== displayed && decodedUrls.has(targetUrl)) {
    setDisplayed(targetUrl)
  }

  useEffect(() => {
    decodedUrls.add(displayed)
  }, [displayed])

  useEffect(() => {
    if (targetUrl === displayed || decodedUrls.has(targetUrl)) return undefined

    let cancelled = false
    const image = new Image()
    image.src = targetUrl
    const commit = (): void => {
      decodedUrls.add(targetUrl)
      if (!cancelled) setDisplayed(targetUrl)
    }
    if (typeof image.decode === 'function') {
      image.decode().then(commit).catch(commit)
    } else {
      image.onload = commit
      image.onerror = commit
    }
    return () => {
      cancelled = true
    }
  }, [targetUrl, displayed])

  return displayed
}

/** Warms the browser cache for the scenes just outside the current pair, and decodes them
 *  into the shared `decodedUrls` cache so that when scrubbing reaches them, `useDecodedSrc`
 *  can adopt them synchronously instead of decoding on demand. */
function usePreload(urls: readonly string[]): void {
  const key = urls.join('|')
  useEffect(() => {
    const urlList = key.length === 0 ? [] : key.split('|')
    const images = urlList.map((url) => {
      const image = new Image()
      image.src = url
      const mark = (): void => {
        decodedUrls.add(url)
      }
      if (typeof image.decode === 'function') {
        image.decode().then(mark).catch(mark)
      } else {
        image.onload = mark
        image.onerror = mark
      }
      return image
    })
    return () => {
      for (const image of images) image.src = ''
    }
  }, [key])
}

function neighbourUrls(scenes: readonly Scene[], pair: { from: Scene; to: Scene }, assetBase: string): string[] {
  const iFrom = scenes.findIndex((s) => s.id === pair.from.id)
  const iTo = scenes.findIndex((s) => s.id === pair.to.id)
  const lo = Math.min(iFrom, iTo)
  const hi = Math.max(iFrom, iTo)
  const urls: string[] = []
  const before = scenes[lo - 1]
  const after = scenes[hi + 1]
  if (before !== undefined) urls.push(resolveAssetUrl(assetBase, before.image))
  if (after !== undefined) urls.push(resolveAssetUrl(assetBase, after.image))
  return urls
}

export function SceneView({ t, scenes, chapters, assetBase, renderCaption, className }: SceneViewProps): ReactNode {
  const pair = useMemo(() => sceneAt(scenes, chapters, t), [scenes, chapters, t])

  const baseUrl = resolveAssetUrl(assetBase, pair.from.image)
  const overlayUrl = resolveAssetUrl(assetBase, pair.to.image)
  const displayedBase = useDecodedSrc(baseUrl)
  const displayedOverlay = useDecodedSrc(overlayUrl)

  usePreload(useMemo(() => neighbourUrls(scenes, pair, assetBase), [scenes, pair, assetBase]))

  const caption = renderCaption?.(dominantScene(pair))

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <img
        src={displayedBase}
        alt={pair.from.caption}
        data-testid="scene-base"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          opacity: 1,
        }}
      />
      <img
        src={displayedOverlay}
        alt={pair.to.caption}
        data-testid="scene-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          opacity: pair.mix,
        }}
      />
      {caption}
    </div>
  )
}
