import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { estimateCrossSection, fitBodyGeometry, makeHeightMapper } from './bodyFit'
import type { BodyLandmarks } from './bodyFit'
import { DEFAULT_MEASUREMENTS } from './types'

const landmarks: BodyLandmarks = {
  floorY: 0,
  inseamY: 0.78,
  hipY: 0.95,
  waistY: 1.1,
  chestY: 1.3,
  shoulderY: 1.4,
  neckCutoffY: 1.5,
  centerX: 0,
  centerZ: 0,
  shoulderWidth: 0.4,
}

describe('body fit', () => {
  it('maps the neck cutoff to target height minus scan height', () => {
    const mapper = makeHeightMapper(landmarks, { ...DEFAULT_MEASUREMENTS, heightCm: 180 }, 0.25)
    expect(mapper.mapY(landmarks.neckCutoffY)).toBeCloseTo(1.55, 5)
    expect(mapper.mapY(0)).toBeCloseTo(0, 5)
  })

  it('changes body vertices without needing a face scan', () => {
    const geometry = new BufferGeometry()
    const vertices = new Float32Array([
      -0.15, 1.3, 0.1, 0.15, 1.3, 0.1, -0.15, 1.3, -0.1, 0.15, 1.3, -0.1,
      -0.1, 0.95, 0.1, 0.1, 0.95, 0.1, -0.1, 0.95, -0.1, 0.1, 0.95, -0.1,
    ])
    geometry.setAttribute('position', new BufferAttribute(vertices, 3))
    const fitted = fitBodyGeometry(geometry, {
      measurements: { ...DEFAULT_MEASUREMENTS, chestCm: 120, heightCm: 180 },
      landmarks,
      scanHeightMeters: 0.25,
      baseCircumferences: { chest: 0.9, waist: 0.75, hips: 0.95 },
    })
    const position = fitted.getAttribute('position')
    expect(position.getX(1)).toBeGreaterThan(0.15)
    expect(position.getY(0)).toBeGreaterThan(1.3)
  })

  it('estimates a cross-section circumference from a vertex ring', () => {
    const geometry = new BufferGeometry()
    const ring: number[] = []
    for (let i = 0; i < 32; i += 1) {
      const angle = (i / 32) * Math.PI * 2
      ring.push(Math.cos(angle) * 0.15, 1.3, Math.sin(angle) * 0.1)
    }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(ring), 3))
    const estimate = estimateCrossSection(geometry, 1.3)
    expect(estimate?.circumference).toBeGreaterThan(0.7)
    expect(estimate?.circumference).toBeLessThan(0.9)
  })
})
