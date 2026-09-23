'use client'

/**
 * Fallback scene renderer for browsers without WebGL: a plain two-`<img>` cross-fade (base
 * fixed at opacity 1, overlay at `mix` — never both faded at once), each cropped by
 * `object-fit: cover` at the `object-position` that reproduces its scene's focus-centred window
 * (`framing.ts`, ADR-045), with a CSS transform applying the portrait zoom (ADR-047) and standing
 * in for camera drift. No CSS filter is applied — `mix` is already the eased crossfade
 * alpha (`transition.ts`'s `crossfadeAlpha`), so a plain opacity ramp is the whole effect
 * (ADR-012). Never shows a blank frame: each layer decodes its next image off-DOM before
 * swapping to it, keeping its last decoded image up while the next one decodes; scenes ahead of
 * the current pair are prefetched and decoded before they are needed (`prefetch.ts`).
 */

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

import { isAbortError } from '@/lib/imagePrefetcher'

import type { DriftUniforms } from './drift'
import { CENTRED_CROP, coverCss, coverTransform, FULL_WINDOW, type CoverCss, type SceneCrop } from './framing'
import { sceneImageBytes } from './sceneImageBytes'

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

/**
 * Fetches `decodeUrls`, then `fetchUrls` (`sceneImageBytes`), and decodes each of `decodeUrls`
 * off-DOM once its bytes arrive, the `<img>` request itself answered by the HTTP cache.
 */
function useScenePrefetch(decodeUrls: readonly string[], fetchUrls: readonly string[]): void {
  useEffect(() => {
    const pending = (url: string): boolean => !decodedUrls.has(url)
    sceneImageBytes.want([], [...decodeUrls.filter(pending), ...fetchUrls.filter(pending)])

    let cancelled = false
    const images: HTMLImageElement[] = []
    for (const url of decodeUrls.filter(pending)) {
      sceneImageBytes
        .whenStored(url)
        .then(() => {
          if (cancelled) return
          const image = new Image()
          image.src = url
          images.push(image)
          const mark = (): void => {
            decodedUrls.add(url)
          }
          if (typeof image.decode === 'function') {
            image.decode().then(mark).catch(mark)
          } else {
            image.onload = mark
            image.onerror = mark
          }
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) console.error(error)
        })
    }
    return () => {
      cancelled = true
      for (const image of images) image.src = ''
    }
  }, [decodeUrls, fetchUrls])
}

/** Width / height of the element's rendered box, or `null` until it has been laid out. */
function useBoxAspect(ref: RefObject<HTMLElement | null>): number | null {
  const [aspect, setAspect] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = (width: number, height: number): void => {
      setAspect(width > 0 && height > 0 ? width / height : null)
    }
    const box = el.getBoundingClientRect()
    measure(box.width, box.height)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) measure(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return aspect
}

export interface SceneFallbackViewProps {
  baseUrl: string
  overlayUrl: string
  baseCaption: string
  overlayCaption: string
  /** Scenes to decode ahead of need, most urgent first (`prefetch.ts`). */
  decodeUrls: readonly string[]
  /** Scenes whose bytes to fetch without decoding, most urgent first. */
  fetchUrls: readonly string[]
  /** Crossfade alpha (`transition.ts`'s `crossfadeAlpha`, already eased) — `0` shows `baseUrl`
   *  alone, `1` shows `overlayUrl` alone. */
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  /** Every scene image's width / height (see `SceneCanvasViewProps.imageAspect`). */
  imageAspect: number
  /** Crop of each image URL whose scene has framing; any other URL crops centred. Looked up by
   *  the URL each layer is actually displaying, which can lag the requested one. */
  cropByUrl: ReadonlyMap<string, SceneCrop>
}

export function SceneFallbackView({
  baseUrl,
  overlayUrl,
  baseCaption,
  overlayCaption,
  decodeUrls,
  fetchUrls,
  mix,
  fromDrift,
  toDrift,
  imageAspect,
  cropByUrl,
}: SceneFallbackViewProps) {
  const displayedBase = useDecodedSrc(baseUrl)
  const displayedOverlay = useDecodedSrc(overlayUrl)
  useScenePrefetch(decodeUrls, fetchUrls)
  const baseRef = useRef<HTMLImageElement | null>(null)
  const boxAspect = useBoxAspect(baseRef)
  const cssOf = (url: string, drift: DriftUniforms): CoverCss =>
    boxAspect === null || !(imageAspect > 0)
      ? { objectPosition: 'center', transform: coverTransform(drift, FULL_WINDOW) }
      : coverCss(imageAspect, boxAspect, cropByUrl.get(url) ?? CENTRED_CROP, drift)
  const baseCss = cssOf(displayedBase, fromDrift)
  const overlayCss = cssOf(displayedOverlay, toDrift)

  return (
    <>
      <img
        ref={baseRef}
        src={displayedBase}
        alt={baseCaption}
        data-testid="scene-base"
        style={{
          ...layerStyle,
          opacity: 1,
          ...baseCss,
        }}
      />
      <img
        src={displayedOverlay}
        alt={overlayCaption}
        data-testid="scene-overlay"
        style={{
          ...layerStyle,
          opacity: mix,
          ...overlayCss,
        }}
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
  transformOrigin: 'center',
}
