'use client'

/**
 * Fallback scene renderer for browsers without WebGL: a plain two-`<img>` cross-fade (base
 * fixed at opacity 1, overlay at `mix` — never both faded at once), each cropped by
 * `object-fit: cover` at the `object-position` that reproduces its scene's focus-centred window
 * (`framing.ts`, ADR-045), with a CSS transform applying the portrait zoom (ADR-047) and standing
 * in for camera drift. No CSS filter is applied — `mix` is already the eased crossfade
 * alpha (`transition.ts`'s `crossfadeAlpha`), so a plain opacity ramp is the whole effect
 * (ADR-012). Never shows a blank frame: each layer decodes its next image off-DOM before
 * swapping to it, keeping its last decoded image up while the next one decodes; scenes just
 * outside the current pair are preloaded speculatively.
 */

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

import type { DriftUniforms } from './drift'
import { CENTRED_CROP, coverCss, coverTransform, FULL_WINDOW, type CoverCss, type SceneCrop } from './framing'

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
  preloadUrls: readonly string[]
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
  preloadUrls,
  mix,
  fromDrift,
  toDrift,
  imageAspect,
  cropByUrl,
}: SceneFallbackViewProps) {
  const displayedBase = useDecodedSrc(baseUrl)
  const displayedOverlay = useDecodedSrc(overlayUrl)
  usePreload(preloadUrls)
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
