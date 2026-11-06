import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

// The upstream author explicitly licenses this particular avatar CC0.
// Do not substitute another TalkingHead example: several have different licenses.
const SOURCE = {
  repository: 'met4citizen/TalkingHead',
  commit: '1563de184c19b310de4b636664d5835e2c74dbba',
  path: 'avatars/mpfb.glb',
  blob: 'cd2ebbe1fe8bcbf3d5b2dfbf1262a7f76814e68f',
  bytes: 36815920,
  sha256: '63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c',
  license: 'CC0-1.0',
}
const headers = { 'User-Agent': 'FitVision-avatar-asset-preparation', Accept: 'application/vnd.github+json' }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function github(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`GitHub: ${response.status} ${response.statusText} (${url})`)
  return response
}

await mkdir('.asset-cache', { recursive: true })
await mkdir('public/models', { recursive: true })
const cache = '.asset-cache/mpfb-source.glb'
let source
if (existsSync(cache)) {
  source = await readFile(cache)
  if (sha256(source) !== SOURCE.sha256) throw new Error('Cached source checksum mismatch; remove .asset-cache/mpfb-source.glb and retry.')
} else {
  console.log('Downloading the pinned, CC0 MPFB avatar through the GitHub blob API…')
  const metadata = await (await github(`https://api.github.com/repos/${SOURCE.repository}/git/blobs/${SOURCE.blob}`)).json()
  if (metadata.encoding !== 'base64' || metadata.size !== SOURCE.bytes) throw new Error('Unexpected GitHub blob metadata.')
  source = Buffer.from(metadata.content, 'base64')
  if (source.length !== SOURCE.bytes || sha256(source) !== SOURCE.sha256) throw new Error('Downloaded avatar failed byte-length / SHA-256 verification.')
  await writeFile(cache, source)
}

const readme = Buffer.from((await (await github(`https://api.github.com/repos/${SOURCE.repository}/contents/README.md?ref=${SOURCE.commit}`)).json()).content, 'base64').toString('utf8')
const attribution = readme.split('\n').find((line) => line.includes('"mpfb.glb"') && line.includes('CC0'))
if (!attribution) throw new Error('Could not verify the upstream CC0 attribution for mpfb.glb.')
const legal = Buffer.from((await (await github('https://api.github.com/repos/makehumancommunity/makehuman/contents/LICENSE.ASSETS.md?ref=ba2399bb706b97c5eefab75ca9bc2d9331681097')).json()).content, 'base64')
await writeFile('public/models/CC0-LICENSE.txt', legal)

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const document = await io.readBinary(new Uint8Array(source))
// Preserve all vertices, topology, UVs, skin weights, bones and morph targets.
// Only resize the oversized clothing normal map and encode textures / buffers.
await document.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 92 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
)
const output = await io.writeBinary(document)
await writeFile('public/models/base-avatar.glb', output)
const root = document.getRoot()
const meshes = root.listMeshes()
const triangles = meshes.reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, primitive) => {
  const indices = primitive.getIndices()
  return n + (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3
}, 0), 0)
const manifest = {
  id: 'mpfb-base-01',
  name: 'Base avatar 01',
  url: '/models/base-avatar.glb',
  format: 'glTF 2.0 binary',
  license: SOURCE.license,
  licenseUrl: '/models/CC0-LICENSE.txt',
  attribution: 'MPFB / MakeHuman reference avatar, created by Mika Suominen (met4citizen).',
  source: {
    ...SOURCE,
    url: `https://github.com/${SOURCE.repository}/blob/${SOURCE.commit}/${SOURCE.path}`,
    downloadUrl: `https://api.github.com/repos/${SOURCE.repository}/git/blobs/${SOURCE.blob}`,
    licenseStatement: attribution.trim(),
  },
  bytes: output.byteLength,
  sha256: sha256(output),
  triangles,
  meshes: meshes.length,
  joints: Math.max(0, ...root.listSkins().map((skin) => skin.listJoints().length)),
  textures: root.listTextures().map((texture) => ({ name: texture.getName(), mimeType: texture.getMimeType(), size: texture.getSize() })),
  materials: root.listMaterials().length,
  morphTargets: meshes.reduce((n, mesh) => n + mesh.listPrimitives().reduce((m, p) => m + p.listTargets().length, 0), 0),
  optimizations: ['WebP textures (quality 92, maximum 2048 × 2048)', 'Meshopt compression; no mesh simplification'],
  personalization: 'Base asset only. No user likeness, photo reconstruction or body measurements have been applied.',
}
const serialized = JSON.stringify(manifest, null, 2) + '\n'
await writeFile('public/models/base-avatar.manifest.json', serialized)
// The app imports this generated contract so its runtime integrity check cannot drift from the asset.
await writeFile('src/avatar/asset-manifest.json', serialized)
console.log(`Verified source: ${SOURCE.sha256}`)
console.log(`Wrote public/models/base-avatar.glb: ${(output.byteLength / 1024 / 1024).toFixed(2)} MiB`)
console.log(`${triangles.toLocaleString()} triangles · ${manifest.joints} joints · ${manifest.textures.length} textures · ${manifest.morphTargets} morph targets`)
