import { Box3, BufferAttribute, BufferGeometry, Mesh, SkinnedMesh, Vector3 } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Mesh as ThreeMesh } from 'three'

/** Clip a baked body mesh to y <= cutoff, preserving UVs and interpolating normals. */
export function clipGeometryBelowY(source: BufferGeometry, cutoffY: number): BufferGeometry {
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  const uv = source.getAttribute('uv')
  const index = source.index
  const triangleCount = Math.floor((index ? index.count : position.count) / 3)
  const outPosition: number[] = []
  const outNormal: number[] = []
  const outUv: number[] = []

  interface Vert { p: Vector3; n: Vector3; uv: [number, number] }
  const read = (i: number): Vert => ({
    p: new Vector3().fromBufferAttribute(position as BufferAttribute, i),
    n: normal ? new Vector3().fromBufferAttribute(normal as BufferAttribute, i) : new Vector3(0, 1, 0),
    uv: uv ? [uv.getX(i), uv.getY(i)] : [0, 0],
  })
  const interpolate = (a: Vert, b: Vert): Vert => {
    const t = (cutoffY - a.p.y) / (b.p.y - a.p.y)
    return {
      p: a.p.clone().lerp(b.p, t),
      n: a.n.clone().lerp(b.n, t).normalize(),
      uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
    }
  }
  const emit = (v: Vert) => {
    outPosition.push(v.p.x, v.p.y, v.p.z)
    outNormal.push(v.n.x, v.n.y, v.n.z)
    outUv.push(v.uv[0], v.uv[1])
  }

  for (let tri = 0; tri < triangleCount; tri += 1) {
    const ids = index ? [index.getX(tri * 3), index.getX(tri * 3 + 1), index.getX(tri * 3 + 2)] : [tri * 3, tri * 3 + 1, tri * 3 + 2]
    const polygon = [read(ids[0]), read(ids[1]), read(ids[2])]
    const clipped: Vert[] = []
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i]
      const next = polygon[(i + 1) % polygon.length]
      const currentInside = current.p.y <= cutoffY
      const nextInside = next.p.y <= cutoffY
      if (currentInside) clipped.push(current)
      if (currentInside !== nextInside) clipped.push(interpolate(current, next))
    }
    for (let i = 1; i + 1 < clipped.length; i += 1) {
      emit(clipped[0]); emit(clipped[i]); emit(clipped[i + 1])
    }
  }

  let geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(outPosition), 3))
  if (outNormal.length) geometry.setAttribute('normal', new BufferAttribute(new Float32Array(outNormal), 3))
  if (outUv.length) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(outUv), 2))
  // Restore shared vertices where attributes match so the fitted body keeps smooth normals.
  geometry = mergeVertices(geometry, 1e-5)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Bake the authored neutral pose into static float geometry. No primitive substitution. */
export function bakeMesh(mesh: ThreeMesh): BufferGeometry {
  const source = mesh.geometry
  const position = source.getAttribute('position')
  const count = position.count
  mesh.updateWorldMatrix(true, false)
  if (mesh instanceof SkinnedMesh) mesh.skeleton.update()

  // The bundled base uses KHR_mesh_quantization. Write dequantized float positions
  // into a fresh attribute instead of mutating a normalized integer buffer.
  const positions = new Float32Array(count * 3)
  const vertex = new Vector3()
  for (let i = 0; i < count; i += 1) {
    mesh.getVertexPosition(i, vertex)
    positions[i * 3] = vertex.x
    positions[i * 3 + 1] = vertex.y
    positions[i * 3 + 2] = vertex.z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const uv = source.getAttribute('uv')
  if (uv) {
    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i += 1) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  }
  if (source.index) geometry.setIndex(source.index.clone())

  if (mesh instanceof SkinnedMesh) {
    // Match the skinning shader: bind-space result -> local -> world.
    geometry.applyMatrix4(mesh.bindMatrixInverse)
  }
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function meshBounds(meshes: ThreeMesh[]): Box3 {
  const box = new Box3()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const geometry = mesh.geometry
    geometry.computeBoundingBox()
    if (geometry.boundingBox) box.union(geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
  }
  return box
}

export function isAccessoryMesh(mesh: Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const label = [mesh.name, ...materials.map((material) => material.name)].join(' ').toLowerCase()
  return /eyebrow|eyelash|ponytail|hair|teeth|tongue|high-poly|eye/.test(label)
}

export function isBodyOrClothingMesh(mesh: Mesh): boolean {
  if (isAccessoryMesh(mesh)) return false
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const label = [mesh.name, ...materials.map((material) => material.name)].join(' ').toLowerCase()
  return /body|skin|casualsuit|cloth|shirt|pant|shoe/.test(label)
}
