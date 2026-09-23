import { describe, expect, it } from 'vitest'

import { buildGlobeGrid } from './globeGeometry'
import { lonLatToSphere } from './projection'

describe('buildGlobeGrid', () => {
  it('rows run from lat +90 (north) to -90 (south), matching shaders.ts\'s north-up convention', () => {
    const grid = buildGlobeGrid(4, 2)
    const latAt = (iy: number, ix: number) => grid.lonLat[(iy * 5 + ix) * 2 + 1]
    expect(latAt(0, 0)).toBe(90)
    expect(latAt(1, 0)).toBe(0)
    expect(latAt(2, 0)).toBe(-90)
  })

  it('the seam columns (ix = 0 and ix = widthSegments) sit at lon -180 and +180', () => {
    const widthSegments = 8
    const grid = buildGlobeGrid(widthSegments, 4)
    const columns = widthSegments + 1
    const lonAt = (iy: number, ix: number) => grid.lonLat[(iy * columns + ix) * 2]
    expect(lonAt(2, 0)).toBe(-180)
    expect(lonAt(2, widthSegments)).toBe(180)
  })

  it('never emits a face joining the last column back to the first (no seam-spanning triangle)', () => {
    const widthSegments = 8
    const grid = buildGlobeGrid(widthSegments, 4)
    const columns = widthSegments + 1
    for (let i = 0; i < grid.indices.length; i += 3) {
      const [a, b, c] = [grid.indices[i]!, grid.indices[i + 1]!, grid.indices[i + 2]!]
      const cols = [a % columns, b % columns, c % columns]
      const spansSeam = cols.includes(0) && cols.includes(widthSegments)
      expect(spansSeam).toBe(false)
    }
  })

  it('emits both triangles for every quad, including the polar rows', () => {
    const widthSegments = 4
    const heightSegments = 4
    const grid = buildGlobeGrid(widthSegments, heightSegments)
    expect(grid.indices.length).toBe(2 * widthSegments * heightSegments * 3)
  })

  it('faces every triangle outward when placed with lonLatToSphere', () => {
    const widthSegments = 8
    const heightSegments = 8
    const grid = buildGlobeGrid(widthSegments, heightSegments)
    const positions: (readonly [number, number, number])[] = []
    for (let i = 0; i < grid.lonLat.length; i += 2) {
      positions.push(lonLatToSphere({ lon: grid.lonLat[i]!, lat: grid.lonLat[i + 1]! }))
    }

    const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
    const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
      a[1]! * b[2]! - a[2]! * b[1]!,
      a[2]! * b[0]! - a[0]! * b[2]!,
      a[0]! * b[1]! - a[1]! * b[0]!,
    ]
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

    let checked = 0
    for (let i = 0; i < grid.indices.length; i += 3) {
      const p0 = positions[grid.indices[i]!]!
      const p1 = positions[grid.indices[i + 1]!]!
      const p2 = positions[grid.indices[i + 2]!]!
      const normal = cross(sub(p1, p0), sub(p2, p0))
      if (Math.hypot(...normal) < 1e-9) continue
      const center = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3]
      expect(dot(normal, center)).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})
