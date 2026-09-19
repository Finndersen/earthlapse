import { describe, expect, it } from 'vitest'

import { budgetedDpr, SCENE_DPR_BUDGET_PIXELS } from './canvasBudget'

describe('budgetedDpr', () => {
  it('returns the full device pixel ratio on an ordinary laptop viewport', () => {
    // 1440x900 at dpr 2 is exactly the ~5.2M px reference case the budget was set from.
    expect(budgetedDpr(2, 1440, 900, SCENE_DPR_BUDGET_PIXELS)).toBeCloseTo(2, 1)
  })

  it('is a no-op (always 1) on a non-retina display, however large', () => {
    expect(budgetedDpr(1, 2560, 1440, SCENE_DPR_BUDGET_PIXELS)).toBeCloseTo(1)
  })

  it('tapers below the device pixel ratio on a 5K-class viewport, bounding the buffer at the budget', () => {
    const width = 2560
    const height = 1440
    const dpr = budgetedDpr(2, width, height, SCENE_DPR_BUDGET_PIXELS)
    expect(dpr).toBeLessThan(2)
    expect(dpr).toBeGreaterThan(1)
    const bufferPixels = width * dpr * height * dpr
    expect(bufferPixels).toBeLessThanOrEqual(SCENE_DPR_BUDGET_PIXELS * 1.001)
  })

  it('never goes below 1 even for a huge viewport (no upscaling)', () => {
    expect(budgetedDpr(2, 8000, 4000, SCENE_DPR_BUDGET_PIXELS)).toBeCloseTo(1)
  })

  it('never exceeds the display’s own device pixel ratio', () => {
    expect(budgetedDpr(3, 250, 250, SCENE_DPR_BUDGET_PIXELS)).toBeCloseTo(3)
  })

  it('treats a zero-area viewport as a no-op rather than dividing by zero', () => {
    expect(budgetedDpr(2, 0, 0, SCENE_DPR_BUDGET_PIXELS)).toBe(1)
  })
})
