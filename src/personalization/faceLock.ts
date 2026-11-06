import { BufferGeometry, Mesh, Object3D } from 'three'
import type { FaceLockProof } from './types'

export const FACE_SCAN_PREFIX = 'FaceScan_'

export interface GeometryFingerprint {
  vertexCount: number
  triangleCount: number
  positionSha256: string
  indexSha256: string
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Canonical, de-interleaved local geometry values. Node transforms are intentionally excluded. */
export async function fingerprintGeometry(geometry: BufferGeometry): Promise<GeometryFingerprint> {
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('Scan mesh has no position attribute.')
  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i += 1) {
    positions[i * 3] = position.getX(i)
    positions[i * 3 + 1] = position.getY(i)
    positions[i * 3 + 2] = position.getZ(i)
  }
  const index = geometry.index
  const indices = new Uint32Array(index ? index.count : position.count)
  for (let i = 0; i < indices.length; i += 1) indices[i] = index ? index.getX(i) : i
  return {
    vertexCount: position.count,
    triangleCount: Math.floor(indices.length / 3),
    positionSha256: await sha256Hex(new Uint8Array(positions.buffer)),
    indexSha256: await sha256Hex(new Uint8Array(indices.buffer)),
  }
}

export async function fingerprintScanMeshes(root: Object3D, namePrefix = ''): Promise<Map<string, GeometryFingerprint>> {
  const result = new Map<string, GeometryFingerprint>()
  let ordinal = 0
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && (!namePrefix || object.name.startsWith(namePrefix))) meshes.push(object)
  })
  meshes.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
  for (const mesh of meshes) {
    const key = mesh.name || `${FACE_SCAN_PREFIX}${ordinal}`
    ordinal += 1
    if (result.has(key)) throw new Error(`Duplicate scan mesh name: ${key}`)
    result.set(key, await fingerprintGeometry(mesh.geometry))
  }
  if (!result.size) throw new Error('No scan meshes were found for face-lock verification.')
  return result
}

export async function combineFingerprints(fingerprints: Map<string, GeometryFingerprint>): Promise<{ positionSha256: string; indexSha256: string; vertexCount: number; triangleCount: number; meshCount: number }> {
  const entries = [...fingerprints.entries()].sort(([a], [b]) => a.localeCompare(b))
  const positionSha256 = await sha256Hex(new TextEncoder().encode(entries.map(([name, value]) => `${name}:${value.positionSha256}`).join('\n')))
  const indexSha256 = await sha256Hex(new TextEncoder().encode(entries.map(([name, value]) => `${name}:${value.indexSha256}`).join('\n')))
  return {
    positionSha256,
    indexSha256,
    vertexCount: entries.reduce((sum, [, value]) => sum + value.vertexCount, 0),
    triangleCount: entries.reduce((sum, [, value]) => sum + value.triangleCount, 0),
    meshCount: entries.length,
  }
}

export function compareFingerprints(before: Map<string, GeometryFingerprint>, after: Map<string, GeometryFingerprint>): { equal: boolean; reason?: string } {
  if (before.size !== after.size) return { equal: false, reason: `Scan mesh count changed (${before.size} → ${after.size}).` }
  for (const [name, expected] of before) {
    const actual = after.get(name)
    if (!actual) return { equal: false, reason: `Export is missing scan mesh ${name}.` }
    if (expected.vertexCount !== actual.vertexCount) return { equal: false, reason: `Vertex count changed for ${name}.` }
    if (expected.positionSha256 !== actual.positionSha256) return { equal: false, reason: `Local face vertices changed for ${name}.` }
    if (expected.indexSha256 !== actual.indexSha256) return { equal: false, reason: `Face triangulation changed for ${name}.` }
  }
  return { equal: true }
}

export async function proveFaceLock(before: Map<string, GeometryFingerprint>, after: Map<string, GeometryFingerprint>): Promise<FaceLockProof> {
  const comparison = compareFingerprints(before, after)
  const combined = await combineFingerprints(before)
  if (!comparison.equal) throw new Error(`Face-lock verification failed: ${comparison.reason}`)
  return {
    verified: true,
    method: 'local-vertex-sha256-before-after-glb-roundtrip',
    ...combined,
    maxLocalVertexDeltaMeters: 0,
  }
}
