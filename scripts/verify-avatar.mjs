import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(await readFile('public/models/base-avatar.manifest.json', 'utf8'))
const bytes = await readFile('public/models/base-avatar.glb')
const hash = createHash('sha256').update(bytes).digest('hex')
if (bytes.length !== manifest.bytes || hash !== manifest.sha256) throw new Error(`Local avatar integrity mismatch: ${bytes.length} bytes, SHA-256 ${hash}`)
if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB header or byte length.')
let offset = 12
let json
let binary
while (offset + 8 <= bytes.length) {
  const length = bytes.readUInt32LE(offset)
  const type = bytes.toString('ascii', offset + 4, offset + 8)
  if (offset + 8 + length > bytes.length) throw new Error('Truncated GLB chunk.')
  const chunk = bytes.subarray(offset + 8, offset + 8 + length)
  if (type === 'JSON') json = JSON.parse(chunk.toString('utf8'))
  if (type === 'BIN\0') binary = chunk
  offset += 8 + length
}
if (!json || !binary) throw new Error('GLB requires JSON and binary chunks.')
if (!json.meshes?.length || !json.skins?.length || !json.images?.length) throw new Error('Avatar is missing meshes, rig or textures.')
if (json.images.some((image) => image.uri || image.bufferView === undefined)) throw new Error('Expected a self-contained GLB with embedded images.')
if (!json.extensionsRequired?.includes('EXT_meshopt_compression')) throw new Error('Expected Meshopt-compressed asset.')
for (const view of json.bufferViews ?? []) {
  const buffer = json.buffers[view.buffer]
  const end = (view.byteOffset ?? 0) + view.byteLength
  // Meshopt's uncompressed fallback buffer is virtual, not a second BIN chunk.
  const limit = buffer.extensions?.EXT_meshopt_compression?.fallback ? buffer.byteLength : binary.length
  if (end > limit) throw new Error('A buffer view exceeds its backing buffer.')
}
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView]
  const start = view.byteOffset ?? 0
  const data = binary.subarray(start, start + view.byteLength)
  const valid = image.mimeType === 'image/webp' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
    : image.mimeType === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : image.mimeType === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 : false
  if (!valid) throw new Error(`Invalid embedded texture: ${image.name}`)
}
console.log(`PASS: local GLB integrity, GLB v2 chunks, ${json.images.length} embedded textures, rig and Meshopt metadata (${bytes.length} bytes).`)
console.log(`SHA-256: ${hash}`)
