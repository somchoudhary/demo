import { describe, expect, it } from 'vitest'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { frameBounds, VIEW_DIRECTIONS, zoomPercent } from './camera'

const humanBounds = () => new Box3(new Vector3(-0.32, 0, -0.18), new Vector3(0.32, 1.68, 0.22))

describe('camera framing', () => {
  for (const aspect of [1.6, 1, 0.72, 0.45]) {
    for (const [name, direction] of Object.entries(VIEW_DIRECTIONS)) {
      it(`keeps every head/foot/hand corner inside a ${aspect} aspect ${name} view`, () => {
        const bounds = humanBounds()
        const framing = frameBounds(bounds, aspect, 35, direction)
        const camera = new PerspectiveCamera(35, aspect, framing.near, framing.far)
        camera.position.copy(framing.position)
        camera.lookAt(framing.target)
        camera.updateMatrixWorld(true)
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(camera)
              expect(Math.abs(projected.x)).toBeLessThan(0.96)
              expect(Math.abs(projected.y)).toBeLessThan(0.96)
              expect(projected.z).toBeGreaterThan(-1)
              expect(projected.z).toBeLessThan(1)
            }
          }
        }
        expect(framing.minDistance).toBeLessThan(framing.fitDistance)
        expect(framing.maxDistance).toBeGreaterThan(framing.fitDistance)
      })
    }
  }

  it('centers the measured body rather than the authored bind pose', () => {
    const bounds = new Box3(new Vector3(2, -0.4, 5), new Vector3(2.6, 1.3, 5.4))
    const framing = frameBounds(bounds, 1, 35)
    expect(framing.target.x).toBeCloseTo(2.3)
    expect(framing.target.y).toBeCloseTo(0.45)
    expect(framing.target.z).toBeCloseTo(5.2)
  })

  it('rejects empty and non-finite bounds', () => {
    expect(() => frameBounds(new Box3(), 1, 35)).toThrow(/empty/)
    expect(() => frameBounds(new Box3(new Vector3(0, 0, 0), new Vector3(1, Infinity, 1)), 1, 35)).toThrow(/invalid/)
  })

  it('reports zoom relative to the fitted distance', () => {
    expect(zoomPercent(4, 4)).toBe(100)
    expect(zoomPercent(4, 3.2)).toBe(125)
    expect(zoomPercent(4, 5)).toBe(80)
  })
})
