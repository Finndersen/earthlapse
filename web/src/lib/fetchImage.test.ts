import { describe, expect, it } from 'vitest'

import { readBodyWithProgress } from './fetchImage'

function streamedResponse(chunks: readonly number[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size))
      controller.close()
    },
  })
  return new Response(body, { headers })
}

describe('readBodyWithProgress', () => {
  it('reports the fraction received after each chunk, ending at 1', async () => {
    const progress: number[] = []
    const response = streamedResponse([25, 25, 50], { 'Content-Length': '100', 'Content-Type': 'image/webp' })

    const blob = await readBodyWithProgress(response, (fraction) => progress.push(fraction))

    expect(progress).toEqual([0.25, 0.5, 1, 1])
    expect(blob.size).toBe(100)
    expect(blob.type).toBe('image/webp')
  })

  it('reports only completion when the length is unknown', async () => {
    const progress: number[] = []

    const blob = await readBodyWithProgress(streamedResponse([10, 20], {}), (fraction) => progress.push(fraction))

    expect(progress).toEqual([1])
    expect(blob.size).toBe(30)
  })

  it('never reports more than 1 when the body outruns its declared length', async () => {
    const progress: number[] = []

    await readBodyWithProgress(streamedResponse([80, 80], { 'Content-Length': '100' }), (fraction) => progress.push(fraction))

    expect(progress).toEqual([0.8, 1, 1])
  })
})
