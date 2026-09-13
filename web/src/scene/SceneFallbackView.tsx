'use client'

/**
 * Fallback scene renderer for browsers without WebGL: a plain two-`<img>` cross-fade (base
 * fixed at opacity 1, overlay at `mix` — never both faded at once) with a CSS transform
 * standing in for camera drift. No CSS filter is applied — `mix` is already the eased
 * crossfade alpha (`transition.ts`'s `crossfadeAlpha`), so a plain opacity ramp is the whole
 * effect (ADR-012). Never shows a blank frame: each layer decodes its next image off-DOM
 * before swapping to it and keeps showing its last decoded image while the next one decodes;
 * the scenes just outside the current pair are preloaded speculatively.
 */

import { useEffect, useState, type CSSProperties } from 'react'

import type { DriftUniforms } from './drift'

/** URLs this browser session has confirmed decode cleanly. Shared by both layers of every
 *  `SceneFallbackView` instance — see `useDecodedSrc`'s doc comment on why sharing the cache
 *  (rather than one per layer) is what avoids a one-frame flash back to the wrong scene right
 *  at a boundary where a scene flips from overlay to base. */
const decodedUrls = new Set<string>()

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

function driftTransform({ zoom, dx, dy }: DriftUniforms): string {
  return `scale(${zoom}) translate(${-dx * 100}%, ${-dy * 100}%)`
}

export interface SceneFallbackViewProps {
  baseUrl: string
  overlayUrl: string
  baseCaption: string
  overlayCaption: string
  preloadUrls: readonly string[]
  /** Crossfade alpha (`transition.ts`'s `crossfadeAlpha`, already eased) — `0` shows `baseUrl`
   *  alone, `1` shows `overlayUrl` alone. */
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
}

export function SceneFallbackView({
  baseUrl,
  overlayUrl,
  baseCaption,
  overlayCaption,
  preloadUrls,
  mix,
  fromDrift,
  toDrift,
}: SceneFallbackViewProps) {
  const displayedBase = useDecodedSrc(baseUrl)
  const displayedOverlay = useDecodedSrc(overlayUrl)
  usePreload(preloadUrls)

  return (
    <>
      <img
        src={displayedBase}
        alt={baseCaption}
        data-testid="scene-base"
        style={{ ...layerStyle, opacity: 1, transform: driftTransform(fromDrift) }}
      />
      <img
        src={displayedOverlay}
        alt={overlayCaption}
        data-testid="scene-overlay"
        style={{ ...layerStyle, opacity: mix, transform: driftTransform(toDrift) }}
      />
    </>
  )
}

const layerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  transformOrigin: 'center',
}
