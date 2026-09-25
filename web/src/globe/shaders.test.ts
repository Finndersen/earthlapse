import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EMPIRES_DEFINE, GLOBE_FRAGMENT_SHADER, RIM_FRAGMENT_SHADER } from './shaders'

describe('globe fragment shaders', () => {
  it('re-encode their linear-light output for the sRGB canvas', () => {
    expect(GLOBE_FRAGMENT_SHADER).toContain('#include <colorspace_fragment>')
    expect(RIM_FRAGMENT_SHADER).toContain('#include <colorspace_fragment>')
  })
})

describe("the globe's single overlay slot", () => {
  it('defines both ramps and dispatches between them by kind', () => {
    expect(GLOBE_FRAGMENT_SHADER).toContain('vec4 densityRampAt(float density) {')
    expect(GLOBE_FRAGMENT_SHADER).toContain('vec4 clearedLandRampAt(float severity) {')
    const dispatchStart = GLOBE_FRAGMENT_SHADER.indexOf('vec4 overlayColorAt(float encoded) {')
    expect(dispatchStart).toBeGreaterThan(-1)
    const dispatchBody = GLOBE_FRAGMENT_SHADER.slice(dispatchStart, dispatchStart + 400)
    expect(dispatchBody).toContain('clearedLandRampAt(')
    expect(dispatchBody).toContain('densityRampAt(')
  })
})

describe('the empire territories', () => {
  it('compile into the globe shader only under their define', () => {
    const block = new RegExp(`#ifdef ${EMPIRES_DEFINE}\\n[\\s\\S]*?#endif`, 'g')
    const withoutEmpires = GLOBE_FRAGMENT_SHADER.replace(block, '').replace(/\/\/.*$/gm, '')
    expect(GLOBE_FRAGMENT_SHADER).toMatch(block)
    expect(withoutEmpires).not.toMatch(/empire/i)
  })
})

describe("Globe.tsx's uniform props", () => {
  // JSX uniform props are untyped strings; reading both sources is the only place the names meet.
  const globeSource = readFileSync(resolve(process.cwd(), 'src/globe/Globe.tsx'), 'utf8')

  it('each names a uniform the fragment shader declares', () => {
    const bound = [...globeSource.matchAll(/uniforms-(u\w+)-value/g)].map((match) => match[1]!)
    expect(new Set(bound).size).toBeGreaterThan(0)
    const declared = new Set(
      [...GLOBE_FRAGMENT_SHADER.matchAll(/uniform\s+\S+\s+(u\w+)\s*;/g)].map((match) => match[1]!),
    )
    expect([...new Set(bound)].filter((name) => !declared.has(name))).toEqual([])
  })
})
