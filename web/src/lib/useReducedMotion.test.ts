// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useReducedMotion } from './useReducedMotion'

describe('useReducedMotion', () => {
  it('reads false in jsdom (no matchMedia preference set) rather than throwing', () => {
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})
