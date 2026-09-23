'use client'

/**
 * Fallback scene renderer for browsers without WebGL: a plain two-`<img>` cross-fade (base
 * fixed at opacity 1, overlay at `mix` — never both faded at once), each cropped by
 * `object-fit: cover` at the `object-position` that reproduces its scene's focus-centred window
 * (`framing.ts`, ADR-045), with a CSS transform applying the portrait zoom (ADR-047) and standing
 * in for camera drift. No CSS filter is applied to a full image — `mix` is already the eased
 * crossfade alpha (`transition.ts`'s `crossfadeAlpha`), so a plain opacity ramp is the whole
 * effect (ADR-012). Never shows a blank frame: each layer decodes its next image off-DOM before
 * swapping to it, showing that scene's thumbnail, blurred, if it decodes first and the full image
 * is still pending after the grace (ADR-051), and otherwise keeping its last decoded image up; scenes ahead of the current pair are prefetched and
 * decoded before they are needed (`prefetch.ts`), and every thumbnail is.
 *
 * A thumbnail is the image's centre square, and `object-fit: cover` can only crop it, so in a box
 * wider than that square it shows a tighter crop than the full image will; in a portrait box the
 * two match.
 */

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

import { isAbortError } from '@/lib/imagePrefetcher'

import type { DriftUniforms } from './drift'
import { CENTRED_CROP, centreSquareWindow, coverCss, coverTransform, FULL_WINDOW, type CoverCss, type SceneCrop } from './framing'
import type { ThumbnailPrefetch } from './SceneCanvasView'
import { sceneImageBytes } from './sceneImageBytes'
import { thumbnailAllowed } from './sceneLayer'
import { useFullImageGrace } from './useFullImageGrace'

/** Softens a thumbnail's upscale, as the WebGL renderer's blur does. */
const THUMBNAIL_BLUR = 'blur(6px)'

/** URLs this browser session has confirmed decode cleanly. Shared by both layers of every
 *  `SceneFallbackView` instance — see `useDecodedSrc`'s doc comment on why sharing the cache
 *  (rather than one per layer) is what avoids a one-frame flash back to the wrong scene right
 *  at a boundary where a scene flips from overlay to base. */
const decodedUrls = new Set<string>()

function decodeOffDom(url: string, onDone: () => void): HTMLImageElement {
  const image = new Image()
  image.src = url
  const mark = (): void => {
    decodedUrls.add(url)
    onDone()
  }
  if (typeof image.decode === 'function') {
    image.decode().then(mark).catch(mark)
  } else {
    image.onload = mark
    image.onerror = mark
  }
  return image
}

interface DisplayedSrc {
  src: string
  /** Showing `thumbUrl` while `targetUrl` decodes. */
  soft: boolean
}

function useDecodedSrc(targetUrl: string, thumbUrl: string): DisplayedSrc {
  const [displayed, setDisplayed] = useState<DisplayedSrc>({ src: targetUrl, soft: false })
  const [, setDecodedCount] = useState(0)

  const wait = useFullImageGrace(targetUrl, !decodedUrls.has(targetUrl))

  if (displayed.src !== targetUrl && decodedUrls.has(targetUrl)) {
    setDisplayed({ src: targetUrl, soft: false })
  } else if (displayed.src !== targetUrl && displayed.src !== thumbUrl && decodedUrls.has(thumbUrl) && thumbnailAllowed(wait)) {
    setDisplayed({ src: thumbUrl, soft: true })
  }

  useEffect(() => {
    if (!displayed.soft) decodedUrls.add(displayed.src)
  }, [displayed])

  useEffect(() => {
    if (displayed.src === targetUrl || decodedUrls.has(targetUrl)) return undefined
    let cancelled = false
    const redraw = (): void => {
      if (!cancelled) setDecodedCount((count) => count + 1)
    }
    decodeOffDom(targetUrl, redraw)
    if (!decodedUrls.has(thumbUrl)) decodeOffDom(thumbUrl, redraw)
    return () => {
      cancelled = true
    }
  }, [targetUrl, thumbUrl, displayed])

  return displayed
}

/**
 * Fetches the near thumbnails, `decodeUrls`, `fetchUrls` and then every other thumbnail
 * (`sceneImageBytes`), and decodes each of `decodeUrls` and every thumbnail off-DOM once its bytes
 * arrive, the `<img>` request itself answered by the HTTP cache.
 */
function useScenePrefetch(decodeUrls: readonly string[], fetchUrls: readonly string[], thumbUrls: ThumbnailPrefetch): void {
  useEffect(() => {
    const pending = (url: string): boolean => !decodedUrls.has(url)
    sceneImageBytes.want([], [...thumbUrls.near, ...decodeUrls, ...fetchUrls, ...thumbUrls.all].filter(pending))

    let cancelled = false
    const images: HTMLImageElement[] = []
    for (const url of [...thumbUrls.near, ...decodeUrls, ...thumbUrls.all].filter(pending)) {
      sceneImageBytes
        .whenStored(url)
        .then(() => {
          if (!cancelled) images.push(decodeOffDom(url, () => undefined))
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) console.error(error)
        })
    }
    return () => {
      cancelled = true
      for (const image of images) image.src = ''
    }
  }, [decodeUrls, fetchUrls, thumbUrls])
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
  baseThumbUrl: string
  overlayThumbUrl: string
  baseCaption: string
  overlayCaption: string
  /** Scenes to decode ahead of need, most urgent first (`prefetch.ts`). */
  decodeUrls: readonly string[]
  /** Scenes whose bytes to fetch without decoding, most urgent first. */
  fetchUrls: readonly string[]
  thumbUrls: ThumbnailPrefetch
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
  baseThumbUrl,
  overlayThumbUrl,
  baseCaption,
  overlayCaption,
  decodeUrls,
  fetchUrls,
  thumbUrls,
  mix,
  fromDrift,
  toDrift,
  imageAspect,
  cropByUrl,
}: SceneFallbackViewProps) {
  const displayedBase = useDecodedSrc(baseUrl, baseThumbUrl)
  const displayedOverlay = useDecodedSrc(overlayUrl, overlayThumbUrl)
  useScenePrefetch(decodeUrls, fetchUrls, thumbUrls)
  const baseRef = useRef<HTMLImageElement | null>(null)
  const boxAspect = useBoxAspect(baseRef)
  // A thumbnail layer crops its square around the full image's focus, re-expressed in the square.
  const cssOf = ({ src, soft }: DisplayedSrc, sceneUrl: string, drift: DriftUniforms): CSSProperties => {
    const crop = cropByUrl.get(soft ? sceneUrl : src) ?? CENTRED_CROP
    const aspect = soft ? 1 : imageAspect
    const focus = soft ? centreSquareWindow({ x: crop.focus[0], y: crop.focus[1], width: 0, height: 0 }, imageAspect) : null
    const css: CoverCss =
      boxAspect === null || !(imageAspect > 0)
        ? { objectPosition: 'center', transform: coverTransform(drift, FULL_WINDOW) }
        : coverCss(aspect, boxAspect, focus === null ? crop : { ...crop, focus: [clampUnit(focus.x), clampUnit(focus.y)] }, drift)
    return soft ? { ...css, filter: THUMBNAIL_BLUR } : css
  }
  const baseCss = cssOf(displayedBase, baseUrl, fromDrift)
  const overlayCss = cssOf(displayedOverlay, overlayUrl, toDrift)

  return (
    <>
      <img
        ref={baseRef}
        src={displayedBase.src}
        alt={baseCaption}
        data-testid="scene-base"
        style={{
          ...layerStyle,
          opacity: 1,
          ...baseCss,
        }}
      />
      <img
        src={displayedOverlay.src}
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

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const layerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transformOrigin: 'center',
}
