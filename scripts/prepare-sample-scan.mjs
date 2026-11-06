import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

// This is a demo/test scan extracted from the already-licensed CC0 MPFB human.
// It is NOT a procedural placeholder and NOT the user's face.
const SOURCE = '.asset-cache/mpfb-source.glb'
if (!existsSync(SOURCE)) {
  console.error('Run `npm run asset:prepare` first so the pinned CC0 source is cached.')
  process.exit(1)
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const source = await io.readBinary(new Uint8Array(await readFile(SOURCE)))
const body = source.getRoot().listMeshes().find((mesh) => mesh.getName() === 'base')
if (!body) throw new Error('Could not find the MPFB base body mesh.')
const primitive = body.listPrimitives()[0]
const position = primitive.getAttribute('POSITION')
const normal = primitive.getAttribute('NORMAL')
const uv = primitive.getAttribute('TEXCOORD_0')
const indices = primitive.getIndices()
if (!position || !indices) throw new Error('Base body is missing position/index data.')

const CUTOFF_Y = 1.49
const srcPos = position.getArray()
const srcNormal = normal?.getArray()
const srcUv = uv?.getArray()
const srcIndex = indices.getArray()
const keptTriangles = []
for (let i = 0; i < srcIndex.length; i += 3) {
  const tri = [srcIndex[i], srcIndex[i + 1], srcIndex[i + 2]]
  if (tri.every((index) => srcPos[index * 3 + 1] >= CUTOFF_Y)) keptTriangles.push(tri)
}
if (keptTriangles.length < 100) throw new Error('Head extraction produced too few triangles; check cutoff.')

const remap = new Map()
const outPos = []
const outNormal = []
const outUv = []
const outIndex = []
let minY = Infinity
let sumX = 0
let sumZ = 0
let count = 0
for (const tri of keptTriangles) {
  for (const oldIndex of tri) {
    let next = remap.get(oldIndex)
    if (next === undefined) {
      next = count++
      remap.set(oldIndex, next)
      const x = srcPos[oldIndex * 3]
      const y = srcPos[oldIndex * 3 + 1]
      const z = srcPos[oldIndex * 3 + 2]
      outPos.push(x, y, z)
      if (srcNormal) outNormal.push(srcNormal[oldIndex * 3], srcNormal[oldIndex * 3 + 1], srcNormal[oldIndex * 3 + 2])
      if (srcUv) outUv.push(srcUv[oldIndex * 2], srcUv[oldIndex * 2 + 1])
      minY = Math.min(minY, y)
      sumX += x
      sumZ += z
    }
    outIndex.push(next)
  }
}
const centerX = sumX / count
const centerZ = sumZ / count
for (let i = 0; i < outPos.length; i += 3) {
  outPos[i] -= centerX
  outPos[i + 1] -= minY
  outPos[i + 2] -= centerZ
}

const target = new Document()
const buffer = target.createBuffer()
const targetPrimitive = target.createPrimitive()
  .setAttribute('POSITION', target.createAccessor().setType('VEC3').setArray(new Float32Array(outPos)).setBuffer(buffer))
  .setIndices(target.createAccessor().setType('SCALAR').setArray(new Uint32Array(outIndex)).setBuffer(buffer))
if (outNormal.length) targetPrimitive.setAttribute('NORMAL', target.createAccessor().setType('VEC3').setArray(new Float32Array(outNormal)).setBuffer(buffer))
if (outUv.length) targetPrimitive.setAttribute('TEXCOORD_0', target.createAccessor().setType('VEC2').setArray(new Float32Array(outUv)).setBuffer(buffer))

const sourceMaterial = primitive.getMaterial()
const targetMaterial = target.createMaterial('SampleHeadScanSkin').setRoughnessFactor(0.74).setMetallicFactor(0)
const sourceTexture = sourceMaterial?.getBaseColorTexture()
if (sourceTexture?.getImage()) {
  const image = target.createTexture('sample-head-skin')
    .setMimeType(sourceTexture.getMimeType())
    .setImage(sourceTexture.getImage())
  targetMaterial.setBaseColorTexture(image)
}
targetPrimitive.setMaterial(targetMaterial)
const mesh = target.createMesh('SampleHeadScan').addPrimitive(targetPrimitive)
const node = target.createNode('SampleHeadScan').setMesh(mesh)
target.createScene('SampleHeadScan').addChild(node)
target.getRoot().setExtras({
  purpose: 'Demo/test head scan only; not a user likeness',
  license: 'CC0-1.0',
  derivedFrom: 'met4citizen/TalkingHead avatars/mpfb.glb (pinned in base-avatar manifest)',
  extraction: `Actual MPFB head/neck triangles with y >= ${CUTOFF_Y} m; translated so neck cut is at y=0. No vertex deformation.`,
})
const bytes = await io.writeBinary(target)
await mkdir('public/samples', { recursive: true })
await writeFile('public/samples/sample-head-scan.glb', bytes)
await writeFile('public/samples/README.txt', 'sample-head-scan.glb is a CC0 demo/test scan extracted from the bundled MPFB reference human. It is not a user face and is never used as a fallback.\n')
console.log(`Wrote public/samples/sample-head-scan.glb (${bytes.byteLength} bytes, ${count} vertices, ${keptTriangles.length} triangles).`)
