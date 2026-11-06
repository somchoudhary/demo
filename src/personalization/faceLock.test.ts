import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Mesh } from 'three'
import { compareFingerprints, fingerprintGeometry, proveFaceLock } from './faceLock'

function triangle(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1))
  return geometry
}

describe('face lock', () => {
  it('produces stable fingerprints for identical local geometry', async () => {
    const a = await fingerprintGeometry(triangle())
    const b = await fingerprintGeometry(triangle())
    expect(a).toEqual(b)
    expect(a.vertexCount).toBe(3)
    expect(a.triangleCount).toBe(1)
  })

  it('detects a sub-millimeter vertex edit', async () => {
    const before = await fingerprintGeometry(triangle())
    const edited = triangle()
    const position = edited.getAttribute('position')
    position.setX(1, position.getX(1) + 0.0001)
    const after = await fingerprintGeometry(edited)
    expect(compareFingerprints(new Map([['FaceScan_0', before]]), new Map([['FaceScan_0', after]])).equal).toBe(false)
  })

  it('ignores node placement because only local vertices are hashed', async () => {
    const mesh = new Mesh(triangle())
    const before = await fingerprintGeometry(mesh.geometry)
    mesh.position.set(5, -2, 3)
    mesh.rotation.set(0.2, 0.4, -0.1)
    mesh.scale.setScalar(1.1)
    mesh.updateMatrixWorld(true)
    const after = await fingerprintGeometry(mesh.geometry)
    expect(after).toEqual(before)
  })

  it('proves a matching round trip and rejects a missing mesh', async () => {
    const fingerprint = await fingerprintGeometry(triangle())
    const before = new Map([['FaceScan_0', fingerprint]])
    const proof = await proveFaceLock(before, new Map(before))
    expect(proof.verified).toBe(true)
    expect(proof.maxLocalVertexDeltaMeters).toBe(0)
    await expect(proveFaceLock(before, new Map())).rejects.toThrow(/mesh count changed/)
  })
})
