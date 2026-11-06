import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { clipGeometryBelowY } from './geometry'

describe('neck clipping', () => {
  it('keeps below-cutoff triangles and clips crossing triangles at the plane', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([
      -1, 0, 0, 1, 0, 0, 0, 2, 0,
      -1, 0, 0, 1, 0, 0, 0, 0.5, 0,
    ]), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 0.5]), 2))
    const clipped = clipGeometryBelowY(geometry, 1)
    const position = clipped.getAttribute('position')
    const triangleVertices = clipped.index ? clipped.index.count : position.count
    expect(position.count).toBeGreaterThan(0)
    expect(triangleVertices).toBeGreaterThan(0)
    expect(triangleVertices % 3).toBe(0)
    for (let i = 0; i < position.count; i += 1) expect(position.getY(i)).toBeLessThanOrEqual(1)
    expect(clipped.getAttribute('uv').count).toBe(position.count)
  })

  it('drops fully above-cutoff geometry', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 2, 0, 1, 2, 0, 0, 3, 0]), 3))
    const clipped = clipGeometryBelowY(geometry, 1)
    expect(clipped.getAttribute('position').count).toBe(0)
  })
})
