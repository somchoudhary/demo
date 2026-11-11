import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { DetectedFace } from './faceEngine'

/**
 * Local photo-to-3D head reconstruction.
 *
 * Pipeline (all in this browser, no external service):
 *  1. MediaPipe FaceMesh detects 468 landmarks + a real 3D face mesh in the
 *     front photo (see faceEngine.ts).
 *  2. The mesh is aligned to head-local space (Y-up, face toward +Z) using
 *     landmark anchors, then scaled to real-world size from the user's height.
 *  3. The side photo refines profile depth (nose/lips/chin protrusion).
 *  4. The front photo textures the face; scalp, ears, hair and neck complete
 *     the head so it can sit on the fitted body.
 *
 * Honest limits: the face mesh + photo texture give strong likeness, but the
 * back of the head, ears and hair are approximations, and no method can
 * recover true 3D depth that was never photographed.
 */

// MediaPipe FaceMesh landmark indices used as anchors.
export const LANDMARK = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  leftEar: 234,
  rightEar: 454,
  leftCheek: 116,
  rightCheek: 345,
  noseBridge: 168,
} as const

export interface DecodedFaceMesh {
  /** xyz per vertex, length = vertexCount * 3. */
  positions: Float32Array
  /** uv per vertex (raw engine UVs; texture mapping uses landmarks instead). */
  uvs: Float32Array
  /** Triangle indices. */
  indices: Uint32Array
  vertexCount: number
}

export interface HeadFrame {
  origin: Vector3
  right: Vector3
  up: Vector3
  forward: Vector3
}

export interface HeadBuildOptions {
  /** User height in cm; drives real-world head size. */
  heightCm: number
  /** Profile depth ratio from the side photo (1 = no change). */
  depthScale?: number
}

/** Decode the engine vertex buffer (5 floats/vertex: x, y, z, u, v). */
export function decodeFaceMesh(vertexBuffer: Float32Array, indexBuffer: Uint32Array): DecodedFaceMesh {
  if (vertexBuffer.length % 5 !== 0) throw new Error('Face mesh vertex buffer is malformed.')
  const vertexCount = vertexBuffer.length / 5
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  for (let i = 0; i < vertexCount; i += 1) {
    positions[i * 3] = vertexBuffer[i * 5]
    positions[i * 3 + 1] = vertexBuffer[i * 5 + 1]
    positions[i * 3 + 2] = vertexBuffer[i * 5 + 2]
    uvs[i * 2] = vertexBuffer[i * 5 + 3]
    uvs[i * 2 + 1] = vertexBuffer[i * 5 + 4]
  }
  return { positions, uvs, indices: new Uint32Array(indexBuffer), vertexCount }
}

function vertexAt(positions: Float32Array, index: number): Vector3 {
  return new Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
}

/**
 * Convert raw mesh positions to consistent units. The engine reports x/y
 * normalized against image width/height separately, which distorts proportions
 * on non-square photos, while z shares x's scale. Multiplying through to
 * pixel units restores true proportions. If a future engine already returns
 * pixels (large magnitudes), the buffer is left untouched.
 */
export function toConsistentSpace(positions: Float32Array, imageWidth: number, imageHeight: number): Float32Array {
  let maxAbs = 0
  for (let i = 0; i < positions.length / 3; i += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(positions[i * 3]), Math.abs(positions[i * 3 + 1]))
  }
  if (maxAbs > 2 || !(imageWidth > 0) || !(imageHeight > 0)) return positions
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length / 3; i += 1) {
    out[i * 3] = positions[i * 3] * imageWidth
    out[i * 3 + 1] = positions[i * 3 + 1] * imageHeight
    out[i * 3 + 2] = positions[i * 3 + 2] * imageWidth
  }
  return out
}

/**
 * Guarantee the face triangulation is wound for viewing from +Z (face
 * forward). After alignment the nose-tip normal must point forward; if it
 * points backward the winding is flipped. This makes inside-out faces
 * impossible regardless of the engine's triangle-winding convention.
 */
export function ensureForwardWinding(geometry: BufferGeometry): void {
  const index = geometry.index
  if (!index) return
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  if (!normals || normals.count <= LANDMARK.noseTip) return
  if (normals.getZ(LANDMARK.noseTip) >= 0) return
  const array = index.array as Uint32Array | Uint16Array | number[]
  for (let i = 0; i < array.length; i += 3) {
    const temp = array[i + 1] as number
    array[i + 1] = array[i + 2] as number
    array[i + 2] = temp
  }
  index.needsUpdate = true
  geometry.computeVertexNormals()
}

/**
 * Build an orthonormal head frame from mesh-space anchors.
 * Forward = nose tip away from the ear midpoint; up = forehead away from chin.
 */
export function computeHeadFrame(positions: Float32Array, vertexCount: number): HeadFrame {
  if (vertexCount <= LANDMARK.rightEar) throw new Error('Face mesh has too few vertices for head alignment.')
  const noseTip = vertexAt(positions, LANDMARK.noseTip)
  const forehead = vertexAt(positions, LANDMARK.forehead)
  const chin = vertexAt(positions, LANDMARK.chin)
  const leftEar = vertexAt(positions, LANDMARK.leftEar)
  const rightEar = vertexAt(positions, LANDMARK.rightEar)
  const earMid = leftEar.clone().add(rightEar).multiplyScalar(0.5)
  const forward = noseTip.clone().sub(earMid)
  if (forward.lengthSq() < 1e-12) throw new Error('Face mesh nose/ear anchors are degenerate.')
  forward.normalize()
  let up = forehead.clone().sub(chin)
  if (up.lengthSq() < 1e-12) throw new Error('Face mesh forehead/chin anchors are degenerate.')
  up.normalize()
  // Orthonormalize: right = up x forward, then up = forward x right.
  const right = new Vector3().crossVectors(up, forward)
  if (right.lengthSq() < 1e-12) throw new Error('Face mesh axes are degenerate.')
  right.normalize()
  up = new Vector3().crossVectors(forward, right).normalize()
  const origin = forehead.clone().add(chin).multiplyScalar(0.5)
  return { origin, right, up, forward }
}

/** Rotate mesh-space positions into head-local space (x right, y up, z forward). */
export function alignToHeadLocal(positions: Float32Array, frame: HeadFrame): Float32Array {
  const out = new Float32Array(positions.length)
  const v = new Vector3()
  for (let i = 0; i < positions.length / 3; i += 1) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).sub(frame.origin)
    out[i * 3] = v.dot(frame.right)
    out[i * 3 + 1] = v.dot(frame.up)
    out[i * 3 + 2] = v.dot(frame.forward)
  }
  return out
}

/** Face height (forehead -> chin) in head-local units. */
export function faceHeightOf(positions: Float32Array): number {
  const forehead = vertexAt(positions, LANDMARK.forehead)
  const chin = vertexAt(positions, LANDMARK.chin)
  return forehead.distanceTo(chin)
}

/** Uniform scale so the face height matches the target (meters). */
export function scalePositions(positions: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 1) out[i] = positions[i] * factor
  return out
}

/** Non-uniform depth (z) scale for side-profile refinement. */
export function scaleDepth(positions: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length / 3; i += 1) {
    out[i * 3] = positions[i * 3]
    out[i * 3 + 1] = positions[i * 3 + 1]
    out[i * 3 + 2] = positions[i * 3 + 2] * factor
  }
  return out
}

/**
 * Profile depth ratio from front + side landmark sets.
 * Front depth: nose-tip z vs ear z (landmark z is depth). Side depth: nose-tip
 * x vs ear x in the profile image. Ratio > 1 means the side photo shows a
 * deeper profile than the front mesh implies.
 */
export function computeProfileDepthRatio(
  front: { landmarks: { x: number; y: number; z: number }[] },
  side: { landmarks: { x: number; y: number; z: number }[] },
): number {
  const frontDepth = Math.abs(front.landmarks[LANDMARK.noseTip].z - front.landmarks[LANDMARK.leftEar].z)
  const sideDepth = Math.abs(side.landmarks[LANDMARK.noseTip].x - side.landmarks[LANDMARK.leftEar].x)
  if (frontDepth < 1e-6 || sideDepth < 1e-6) return 1
  // Both are normalized image units; compare relative proportions only.
  const ratio = sideDepth / frontDepth
  return Math.min(1.35, Math.max(0.75, ratio))
}

/** Average face height for a person of the given height (meters). */
export function targetFaceHeightMeters(heightCm: number): number {
  // Average forehead->chin length is ~13.5 cm at 170 cm height, scaled linearly.
  return 0.135 * (heightCm / 170)
}

function boundsOf(positions: Float32Array): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < positions.length / 3; i += 1) {
    min.x = Math.min(min.x, positions[i * 3])
    min.y = Math.min(min.y, positions[i * 3 + 1])
    min.z = Math.min(min.z, positions[i * 3 + 2])
    max.x = Math.max(max.x, positions[i * 3])
    max.y = Math.max(max.y, positions[i * 3 + 1])
    max.z = Math.max(max.z, positions[i * 3 + 2])
  }
  return { min, max }
}

/** Sample an average color from a canvas region (normalized coords). */
export function sampleRegionColor(
  canvas: HTMLCanvasElement,
  centerX: number,
  centerY: number,
  radiusFraction = 0.03,
): { r: number; g: number; b: number } {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read photo pixels for head colors.')
  const radius = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * radiusFraction))
  const cx = Math.round(centerX * canvas.width)
  const cy = Math.round(centerY * canvas.height)
  const x0 = Math.max(0, cx - radius)
  const y0 = Math.max(0, cy - radius)
  const w = Math.min(canvas.width - x0, radius * 2)
  const h = Math.min(canvas.height - y0, radius * 2)
  if (w <= 0 || h <= 0) return { r: 0.76, g: 0.6, b: 0.5 }
  const data = ctx.getImageData(x0, y0, w, h).data
  let r = 0; let g = 0; let b = 0; let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1
  }
  if (!n) return { r: 0.76, g: 0.6, b: 0.5 }
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 }
}

function ellipsoid(rx: number, ry: number, rz: number, cap = false): BufferGeometry {
  const geometry = cap
    ? new SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.58)
    : new SphereGeometry(1, 40, 28)
  geometry.scale(rx, ry, rz)
  return geometry
}

function skinMaterial(color: { r: number; g: number; b: number }): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color.r, color.g, color.b), roughness: 0.62, metalness: 0 })
}

/**
 * Build the complete head (face mesh + scalp + ears + hair + neck) in meters,
 * Y-up, facing +Z, origin at face center. The caller places the group at the
 * neck cutoff; the neck cylinder overlaps the body top.
 */
export function buildHeadGroup(
  face: DetectedFace,
  frontCanvas: HTMLCanvasElement,
  options: HeadBuildOptions,
): Group {
  const decoded = decodeFaceMesh(face.vertexBuffer, face.indexBuffer)
  const consistent = toConsistentSpace(decoded.positions, face.imageWidth, face.imageHeight)
  const frame = computeHeadFrame(consistent, decoded.vertexCount)
  let local = alignToHeadLocal(consistent, frame)
  const currentFaceHeight = faceHeightOf(local)
  if (currentFaceHeight < 1e-6) throw new Error('Reconstructed face has zero height.')
  const scale = targetFaceHeightMeters(options.heightCm) / currentFaceHeight
  local = scalePositions(local, scale)
  if (options.depthScale && Math.abs(options.depthScale - 1) > 0.01) {
    local = scaleDepth(local, options.depthScale)
  }

  // Face geometry with photo texture. UVs come from landmarks (image coords,
  // y down -> Three.js v up), which is exact because mesh vertices match
  // landmark indices 1:1.
  const faceGeometry = new BufferGeometry()
  faceGeometry.setAttribute('position', new BufferAttribute(local, 3))
  const uv = new Float32Array(decoded.vertexCount * 2)
  for (let i = 0; i < decoded.vertexCount; i += 1) {
    const landmark = face.landmarks[i]
    if (landmark) {
      uv[i * 2] = landmark.x
      uv[i * 2 + 1] = 1 - landmark.y
    }
  }
  faceGeometry.setAttribute('uv', new BufferAttribute(uv, 2))
  faceGeometry.setIndex(new BufferAttribute(new Uint32Array(decoded.indices), 1))
  ensureForwardWinding(faceGeometry)
  faceGeometry.computeBoundingBox()
  faceGeometry.computeBoundingSphere()

  const photoTexture = new CanvasTexture(frontCanvas)
  photoTexture.colorSpace = 'srgb'
  photoTexture.anisotropy = 4
  const faceMaterial = new MeshStandardMaterial({ map: photoTexture, roughness: 0.55, metalness: 0 })
  const faceMesh = new Mesh(faceGeometry, faceMaterial)
  faceMesh.name = 'FaceScan_0'

  const bounds = boundsOf(local)
  const width = bounds.max.x - bounds.min.x
  const height = bounds.max.y - bounds.min.y
  const depth = bounds.max.z - bounds.min.z
  const centerY = (bounds.max.y + bounds.min.y) / 2

  const cheek = face.landmarks[LANDMARK.leftCheek] ?? { x: 0.3, y: 0.6 }
  const skin = sampleRegionColor(frontCanvas, cheek.x, cheek.y)
  const hairSample = sampleRegionColor(frontCanvas, 0.5, Math.max(0.02, (face.landmarks[LANDMARK.forehead]?.y ?? 0.2) - 0.08))
  const skinMat = skinMaterial(skin)
  const hairMat = new MeshStandardMaterial({ color: new Color(hairSample.r, hairSample.g, hairSample.b), roughness: 0.85, metalness: 0 })

  const head = new Group()
  head.name = 'ReconstructedHead'
  head.add(faceMesh)

  // Scalp / back of head.
  const scalp = new Mesh(ellipsoid(width * 0.60, height * 0.60, depth * 0.95), skinMat)
  scalp.position.set(0, centerY + height * 0.04, bounds.min.z + depth * 0.42)
  scalp.name = 'FaceScan_1'
  head.add(scalp)

  // Ears.
  const earY = face.landmarks[LANDMARK.leftEar]?.y ?? 0.5
  const earLocalY = centerY + (0.5 - earY) * height
  for (const side of [-1, 1]) {
    const ear = new Mesh(ellipsoid(0.011, 0.028, 0.016), skinMat)
    ear.position.set(side * width * 0.52, earLocalY, bounds.min.z + depth * 0.30)
    ear.name = `FaceScan_${side < 0 ? 2 : 3}`
    head.add(ear)
  }

  // Hair cap (top portion of a slightly larger ellipsoid).
  const hair = new Mesh(ellipsoid(width * 0.64, height * 0.62, depth * 1.0, true), hairMat)
  hair.position.set(0, centerY + height * 0.10, bounds.min.z + depth * 0.40)
  hair.name = 'FaceScan_4'
  head.add(hair)

  // Neck: from just below the chin down to overlap the body top.
  const neckTop = bounds.min.y + height * 0.06
  const neckBottom = neckTop - height * 0.55
  const neck = new Mesh(new CylinderGeometry(width * 0.16, width * 0.20, neckTop - neckBottom, 24), skinMat)
  neck.position.set(0, (neckTop + neckBottom) / 2, bounds.min.z + depth * 0.30)
  neck.name = 'FaceScan_5'
  head.add(neck)

  head.updateMatrixWorld(true)
  return head
}
