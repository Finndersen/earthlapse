/**
 * Fetches an image as a decoded `HTMLImageElement`, reporting download progress. Going through
 * `fetch` rather than a bare `img.src` is what makes progress observable at all; `decode()`
 * decodes off the main thread before the texture's first GPU upload needs the pixels.
 */

/** Calls `onProgress` with the fraction of `response`'s body received so far, ending at 1. Without
 *  a `Content-Length` the fraction is unknown, so only the final 1 is reported. */
export async function readBodyWithProgress(response: Response, onProgress?: (fraction: number) => void): Promise<Blob> {
  const total = Number(response.headers.get('Content-Length') ?? 0)
  if (onProgress === undefined || response.body === null || !(total > 0)) {
    const blob = await response.blob()
    onProgress?.(1)
    return blob
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(Math.min(1, received / total))
  }
  onProgress(1)
  return new Blob(chunks, { type: response.headers.get('Content-Type') ?? '' })
}

/** Fetches `url`'s encoded bytes, reporting download progress. */
export async function fetchImageBlob(
  url: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, signal === undefined ? undefined : { signal })
  if (!response.ok) throw new Error(`failed to load image ${url}: HTTP ${response.status}`)
  return readBodyWithProgress(response, onProgress)
}

export type ImageBlobLoader = (url: string, onProgress?: (fraction: number) => void) => Promise<Blob>

/** `loadBlob` supplies the encoded bytes; by default they are fetched from the network. */
export async function fetchImage(
  url: string,
  onProgress?: (fraction: number) => void,
  loadBlob: ImageBlobLoader = fetchImageBlob,
): Promise<HTMLImageElement> {
  const blob = await loadBlob(url, onProgress)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode().catch((error: unknown) => {
      throw new Error(`failed to decode image ${url}: ${error instanceof Error ? error.message : String(error)}`)
    })
    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
