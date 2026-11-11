import { BufferAttribute, BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import {
  alignToHeadLocal,
  computeHeadFrame,
  computeProfileDepthRatio,
  decodeFaceMesh,
  ensureForwardWinding,
  faceHeightOf,
  LANDMARK,
  scaleDepth,
  scalePositions,
  targetFaceHeightMeters,
  toConsistentSpace,
} from './headReconstruction'

/** Synthetic 468-vertex face mesh with anchors in a canonical pose. */
function syntheticPositions(): Float32Array {
  const positions = new Float32Array(468 * 3)
  const set = (index: number, x: number, y: number, z: number) => {
    positions[index * 3] = x; positions[index * 3 + 1] = y; positions[index * 3 + 2] = z
  }
  set(LANDMARK.noseTip, 0, 0, 1)
  set(LANDMARK.forehead, 0, 1, 0)
  set(LANDMARK.chin, 0, -1, 0)
  set(LANDMARK.leftEar, -1, 0, 0)
  set(LANDMARK.rightEar, 1, 0, 0)
  return positions
}

function toVertexBuffer(positions: Float32Array): Float32Array {
  const buffer = new Float32Array(positions.length / 3 * 5)
  for (let i = 0; i < positions.length / 3; i += 1) {
    buffer[i * 5] = positions[i * 3]
    buffer[i * 5 + 1] = positions[i * 3 + 1]
    buffer[i * 5 + 2] = positions[i * 3 + 2]
    buffer[i * 5 + 3] = 0.5
    buffer[i * 5 + 4] = 0.5
  }
  return buffer
}

describe('decodeFaceMesh', () => {
  it('decodes 5-float vertices into positions and uvs', () => {
    const positions = syntheticPositions()
    const decoded = decodeFaceMesh(toVertexBuffer(positions), new Uint32Array([0, 1, 2]))
    expect(decoded.vertexCount).toBe(468)
    expect(decoded.positions[LANDMARK.noseTip * 3 + 2]).toBeCloseTo(1)
    expect(decoded.uvs[0]).toBeCloseTo(0.5)
  })

  it('rejects a malformed vertex buffer', () => {
    expect(() => decodeFaceMesh(new Float32Array([1, 2, 3]), new Uint32Array())).toThrow('malformed')
  })
})

describe('head frame + alignment', () => {
  it('builds an orthonormal frame with nose toward +Z and forehead toward +Y', () => {
    const positions = syntheticPositions()
    const frame = computeHeadFrame(positions, 468)
    expect(frame.forward.toArray()).toEqual([0, 0, 1])
    expect(frame.up.toArray()).toEqual([0, 1, 0])
    expect(frame.right.toArray()).toEqual([1, 0, 0])
    const local = alignToHeadLocal(positions, frame)
    expect(local[LANDMARK.noseTip * 3 + 2]).toBeCloseTo(1)
    expect(local[LANDMARK.forehead * 3 + 1]).toBeCloseTo(1)
    expect(local[LANDMARK.chin * 3 + 1]).toBeCloseTo(-1)
  })

  it('aligns a rotated mesh back to canonical orientation', () => {
    const positions = syntheticPositions()
    // Rotate 90 degrees about Y: (x, y, z) -> (z, y, -x).
    const rotated = new Float32Array(positions.length)
    for (let i = 0; i < positions.length / 3; i += 1) {
      rotated[i * 3] = positions[i * 3 + 2]
      rotated[i * 3 + 1] = positions[i * 3 + 1]
      rotated[i * 3 + 2] = -positions[i * 3]
    }
    const frame = computeHeadFrame(rotated, 468)
    const local = alignToHeadLocal(rotated, frame)
    expect(local[LANDMARK.noseTip * 3 + 2]).toBeCloseTo(1, 5)
    expect(local[LANDMARK.forehead * 3 + 1]).toBeCloseTo(1, 5)
    expect(local[LANDMARK.rightEar * 3]).toBeCloseTo(1, 5)
  })

  it('rejects a mesh with too few vertices', () => {
    expect(() => computeHeadFrame(new Float32Array(30), 10)).toThrow('too few vertices')
  })
})

describe('scaling', () => {
  it('measures face height and scales to real-world size', () => {
    const positions = syntheticPositions()
    expect(faceHeightOf(positions)).toBeCloseTo(2)
    const scaled = scalePositions(positions, targetFaceHeightMeters(170) / 2)
    expect(faceHeightOf(scaled)).toBeCloseTo(0.135, 5)
    expect(targetFaceHeightMeters(170)).toBeCloseTo(0.135, 5)
    expect(targetFaceHeightMeters(340)).toBeCloseTo(0.27, 5)
  })

  it('scales depth independently for profile refinement', () => {
    const positions = syntheticPositions()
    const scaled = scaleDepth(positions, 1.2)
    expect(scaled[LANDMARK.noseTip * 3 + 2]).toBeCloseTo(1.2)
    expect(scaled[LANDMARK.forehead * 3 + 1]).toBeCloseTo(1)
  })
})

describe('computeProfileDepthRatio', () => {
  const landmarks = (nose: { x: number; z: number }, ear: { x: number; z: number }) => {
    const list = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }))
    list[LANDMARK.noseTip] = { ...nose, y: 0 }
    list[LANDMARK.leftEar] = { ...ear, y: 0 }
    return { landmarks: list }
  }

  it('returns 1 when depths match and clamps extreme ratios', () => {
    const front = landmarks({ x: 0.5, z: 0.1 }, { x: 0.3, z: 0.3 })
    const side = landmarks({ x: 0.8, z: 0.1 }, { x: 0.6, z: 0.3 })
    // front depth 0.2, side depth 0.2 -> ratio 1
    expect(computeProfileDepthRatio(front, side)).toBeCloseTo(1, 5)
    const deep = landmarks({ x: 0.9, z: 0.1 }, { x: 0.3, z: 0.3 })
    expect(computeProfileDepthRatio(front, deep)).toBeCloseTo(1.35, 5)
    const shallow = landmarks({ x: 0.4, z: 0.1 }, { x: 0.3, z: 0.3 })
    expect(computeProfileDepthRatio(front, shallow)).toBeCloseTo(0.75, 5)
  })
})

describe('toConsistentSpace', () => {
  it('scales normalized coordinates to pixel units with aspect correction', () => {
    const positions = new Float32Array([0.5, 0.25, 0.1, 0.1, 0.2, -0.05])
    const out = toConsistentSpace(positions, 1000, 500)
    expect(Array.from(out)).toEqual([500, 125, 100, 100, 100, -50])
  })

  it('leaves pixel-scale buffers untouched', () => {
    const positions = new Float32Array([500, 125, 100, 100, 100, -50])
    expect(toConsistentSpace(positions, 1000, 500)).toBe(positions)
  })
})

describe('ensureForwardWinding', () => {
  // Nose-tip (index 1) triangle in the XY plane; normal must end up +Z.
  const triangle = (winding: [number, number, number]) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    geometry.setIndex(winding)
    return geometry
  }

  it('flips backward-wound triangles so the nose normal points forward', () => {
    const geometry = triangle([0, 2, 1])
    ensureForwardWinding(geometry)
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2])
    expect(geometry.getAttribute('normal').getZ(LANDMARK.noseTip)).toBeGreaterThan(0)
  })

  it('leaves forward-wound triangles untouched', () => {
    const geometry = triangle([0, 1, 2])
    ensureForwardWinding(geometry)
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2])
    expect(geometry.getAttribute('normal').getZ(LANDMARK.noseTip)).toBeGreaterThan(0)
  })
})
