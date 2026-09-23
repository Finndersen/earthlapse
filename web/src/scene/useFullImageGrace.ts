import { useEffect, useState } from 'react'

import { FULL_IMAGE_GRACE_MS, type GraceWait } from './sceneLayer'

interface Request {
  key: string
  at: number
  sincePreviousRequestMs: number
}

/**
 * How long the request `requestKey` names has waited for its full images (`sceneLayer.ts`'s
 * `GraceWait`), timed from the render that first asked for it. The timer runs only while
 * `waiting`, so a request already drawn in full costs no extra render.
 */
export function useFullImageGrace(requestKey: string, waiting: boolean): GraceWait {
  const [request, setRequest] = useState<Request>(() => ({
    key: requestKey,
    at: performance.now(),
    sincePreviousRequestMs: Infinity,
  }))
  const [elapsedFor, setElapsedFor] = useState<string | null>(null)
  let current = request
  if (request.key !== requestKey) {
    const at = performance.now()
    current = { key: requestKey, at, sincePreviousRequestMs: at - request.at }
    setRequest(current)
  }

  useEffect(() => {
    if (!waiting) return undefined
    const timer = setTimeout(() => setElapsedFor(requestKey), FULL_IMAGE_GRACE_MS)
    return () => clearTimeout(timer)
  }, [waiting, requestKey])

  return { elapsed: elapsedFor === requestKey, sincePreviousRequestMs: current.sincePreviousRequestMs }
}
