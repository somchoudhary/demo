import {
  Box3,
  Euler,
  Group,
  LoadingManager,
  Mesh,
  SkinnedMesh,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { BASE_AVATAR } from '../avatar/baseAvatar'
import { avatarRepository } from '../avatar/gltfAvatarRepository'
import { disposeAvatarScene } from '../avatar/dispose'
import type { LoadedAvatar } from '../avatar/types'
import { bakeMesh, clipGeometryBelowY, isBodyOrClothingMesh } from './geometry'
import { estimateCrossSection, fitBodyGeometry, makeHeightMapper, measureAchieved } from './bodyFit'
import type { BodyLandmarks } from './bodyFit'
import { FACE_SCAN_PREFIX, fingerprintScanMeshes, proveFaceLock } from './faceLock'
import { validateAlignment, validateMeasurements } from './measurements'
import type { BodyMeasurements, GeneratedAvatar, GenerationProgress, PersonalizationReport, ScanAlignment } from './types'

export interface GenerateAvatarInput {
  scanFile: File
  referencePhoto?: File | null
  measurements: BodyMeasurements
  alignment: ScanAlignment
  signal?: AbortSignal
  onProgress?: (progress: GenerationProgress) => void
}

const MAX_SCAN_BYTES = 80 * 1024 * 1024
const MAX_PHOTO_BYTES = 15 * 1024 * 1024

function report(input: GenerateAvatarInput, stage: GenerationProgress['stage'], message: string): void {
  input.onProgress?.({ stage, message })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Generation cancelled.', 'AbortError')
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bonePosition(root: Group, name: string): Vector3 | null {
  const object = root.getObjectByName(name)
  return object ? object.getWorldPosition(new Vector3()) : null
}

function requireValue(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return value
}

export async function generatePersonalAvatar(input: GenerateAvatarInput): Promise<GeneratedAvatar> {
  const measurementErrors = validateMeasurements(input.measurements)
  if (measurementErrors.length) throw new Error(measurementErrors.join(' '))
  const alignmentErrors = validateAlignment(input.alignment)
  if (alignmentErrors.length) throw new Error(alignmentErrors.join(' '))
  if (!input.scanFile) throw new Error('A 3D head scan is required. A photo alone cannot preserve exact face geometry.')
  if (input.scanFile.size > MAX_SCAN_BYTES) throw new Error('Head scan is larger than 80 MB. Export a decimated GLB and try again.')
  const lowerName = input.scanFile.name.toLowerCase()
  if (!lowerName.endsWith('.glb') && !lowerName.endsWith('.gltf')) throw new Error('Head scan must be a self-contained .glb or .gltf file.')
  if (input.referencePhoto) {
    if (input.referencePhoto.size > MAX_PHOTO_BYTES) throw new Error('Reference photo is larger than 15 MB.')
    if (!/^image\/(png|jpeg|webp)$/.test(input.referencePhoto.type)) throw new Error('Reference photo must be PNG, JPEG or WebP.')
  }

  let base: LoadedAvatar | undefined
  let scanScene: Group | undefined
  let assembled: Group | undefined
  let reimported: Group | undefined
  const bakedGeometries: ReturnType<typeof bakeMesh>[] = []

  try {
    report(input, 'reading-inputs', 'Reading files locally. Nothing is uploaded.')
    throwIfAborted(input.signal)
    const scanBuffer = await input.scanFile.arrayBuffer()
    const scanSha256 = await sha256Hex(scanBuffer)
    let referencePhoto: PersonalizationReport['referencePhoto']
    if (input.referencePhoto) {
      const photoBuffer = await input.referencePhoto.arrayBuffer()
      referencePhoto = { fileName: input.referencePhoto.name, sha256: await sha256Hex(photoBuffer), usedForGeometry: false }
    }

    report(input, 'loading-base', 'Loading the licensed base human.')
    base = await avatarRepository.load(BASE_AVATAR, { signal: input.signal })
    throwIfAborted(input.signal)

    report(input, 'validating-scan', 'Validating the supplied head scan.')
    const localOnlyManager = new LoadingManager()
    localOnlyManager.setURLModifier((url) => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return url
      throw new Error('Head scan must be self-contained. External texture/buffer URLs are not loaded during local generation.')
    })
    const loader = new GLTFLoader(localOnlyManager).setMeshoptDecoder(MeshoptDecoder)
    const scanGltf = lowerName.endsWith('.gltf')
      ? await loader.parseAsync(new TextDecoder().decode(scanBuffer), '')
      : await loader.parseAsync(scanBuffer, '')
    scanScene = scanGltf.scene
    const scanMeshes: Mesh[] = []
    scanScene.traverse((object) => {
      if (object instanceof Mesh) scanMeshes.push(object)
    })
    if (!scanMeshes.length) throw new Error('The head scan contains no renderable mesh.')
    for (const mesh of scanMeshes) {
      if (mesh instanceof SkinnedMesh) throw new Error('The head scan must be a static mesh, not a skinned/rigged character.')
      if (Array.isArray(mesh.material) && mesh.material.length > 1) throw new Error('Please export the head scan with one material per mesh.')
      if (Object.keys(mesh.geometry.morphAttributes).length > 0) throw new Error('Please export a static head scan without morph targets so the face cannot change.')
    }
    scanMeshes.forEach((mesh, index) => { mesh.name = `${FACE_SCAN_PREFIX}${index}` })
    const scanBounds = new Box3().setFromObject(scanScene)
    const scanSize = scanBounds.getSize(new Vector3())
    if (![scanSize.x, scanSize.y, scanSize.z].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Head scan bounds are invalid.')
    if (scanSize.y < 0.08 || scanSize.y > 0.8) throw new Error(`Head scan height is ${scanSize.y.toFixed(3)} m. Export a Y-up scan in meters, trimmed at the neck (expected roughly 0.12–0.60 m).`)
    const faceBefore = await fingerprintScanMeshes(scanScene, FACE_SCAN_PREFIX)
    throwIfAborted(input.signal)

    report(input, 'fitting-body', 'Fitting the imported body to the measurements. The scan is excluded.')
    const bodyMeshes: Mesh[] = []
    base.scene.traverse((object) => {
      if (object instanceof Mesh && isBodyOrClothingMesh(object)) bodyMeshes.push(object)
    })
    if (!bodyMeshes.length) throw new Error('Could not identify the imported body/clothing meshes.')
    const neck = bonePosition(base.scene, 'Neck')
    const hips = bonePosition(base.scene, 'Hips')
    const spine2 = bonePosition(base.scene, 'Spine2')
    const spine1 = bonePosition(base.scene, 'Spine1')
    const leftArm = bonePosition(base.scene, 'LeftArm')
    const rightArm = bonePosition(base.scene, 'RightArm')
    if (!neck || !hips) throw new Error('The base human is missing neck/hip landmarks.')

    const baked = bodyMeshes.map((mesh) => {
      const geometry = bakeMesh(mesh)
      bakedGeometries.push(geometry)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      return { geometry, material: mesh.material, name: mesh.name, isSkin: materials.some((material) => /body|skin/i.test(material.name)) }
    })
    const bodyBox = new Box3()
    for (const item of baked) {
      item.geometry.computeBoundingBox()
      if (item.geometry.boundingBox) bodyBox.union(item.geometry.boundingBox)
    }
    const floorY = bodyBox.min.y
    const hipY = requireValue(hips.y, 0.95)
    const landmarks: BodyLandmarks = {
      floorY,
      inseamY: floorY + (hipY - floorY) * 0.8,
      hipY,
      waistY: requireValue(spine1?.y, hipY + 0.16),
      chestY: requireValue(spine2?.y, hipY + 0.32),
      shoulderY: requireValue(leftArm && rightArm ? (leftArm.y + rightArm.y) / 2 : null, hipY + 0.42),
      neckCutoffY: neck.y,
      centerX: (bodyBox.min.x + bodyBox.max.x) / 2,
      centerZ: requireValue(neck.z, 0),
      shoulderWidth: leftArm && rightArm ? Math.max(Math.abs(leftArm.x - rightArm.x) + 0.06, 0.25) : 0.4,
    }
    const skinGeometry = baked.find((item) => item.isSkin)?.geometry ?? baked[0].geometry
    const baseCircumferences = {
      chest: estimateCrossSection(skinGeometry, landmarks.chestY)?.circumference ?? 0.92,
      waist: estimateCrossSection(skinGeometry, landmarks.waistY)?.circumference ?? 0.76,
      hips: estimateCrossSection(skinGeometry, landmarks.hipY)?.circumference ?? 0.96,
    }
    const uniformScale = input.alignment.scalePercent / 100
    const scanHeightMeters = scanSize.y * uniformScale
    const heightMapper = makeHeightMapper(landmarks, input.measurements, scanHeightMeters)

    assembled = new Group()
    assembled.name = 'PersonalizedAvatar'
    const fittedGeometries = []
    for (const item of baked) {
      const clipped = clipGeometryBelowY(item.geometry, landmarks.neckCutoffY)
      const fitted = fitBodyGeometry(clipped, { measurements: input.measurements, landmarks, scanHeightMeters, baseCircumferences })
      clipped.dispose()
      fittedGeometries.push(fitted)
      const mesh = new Mesh(fitted, item.material)
      mesh.name = `Body_${item.name}`
      assembled.add(mesh)
    }

    report(input, 'attaching-scan', 'Attaching the scan with rigid placement only; scale is locked and local face vertices are untouched.')
    const scanRoot = new Group()
    scanRoot.name = 'FaceScanRoot'
    scanRoot.add(scanScene)
    scanRoot.scale.setScalar(uniformScale)
    scanRoot.rotation.copy(new Euler(
      input.alignment.pitchDeg * Math.PI / 180,
      input.alignment.yawDeg * Math.PI / 180,
      input.alignment.rollDeg * Math.PI / 180,
      'YXZ',
    ))
    scanRoot.updateMatrixWorld(true)
    const placedBounds = new Box3().setFromObject(scanRoot)
    const placedCenter = placedBounds.getCenter(new Vector3())
    const attachY = heightMapper.mapY(landmarks.neckCutoffY)
    scanRoot.position.set(
      landmarks.centerX + input.alignment.offsetXCm / 100 - placedCenter.x,
      attachY + input.alignment.offsetYCm / 100 - placedBounds.min.y,
      landmarks.centerZ + input.alignment.offsetZCm / 100 - placedCenter.z,
    )
    scanRoot.updateMatrixWorld(true)
    assembled.add(scanRoot)
    assembled.updateMatrixWorld(true)
    const totalBounds = new Box3().setFromObject(assembled)
    const totalHeight = totalBounds.max.y - totalBounds.min.y
    const achieved = measureAchieved(fittedGeometries, landmarks, input.measurements, scanHeightMeters, totalHeight)
    throwIfAborted(input.signal)

    report(input, 'exporting', 'Exporting the assembled avatar as a local GLB.')
    const exporter = new GLTFExporter()
    const exported = await exporter.parseAsync(assembled, { binary: true, onlyVisible: true, trs: true, maxTextureSize: 2048 })
    if (!(exported instanceof ArrayBuffer)) throw new Error('GLB export did not return a binary buffer.')
    throwIfAborted(input.signal)

    report(input, 'verifying-face-lock', 'Re-importing the GLB and hashing every face vertex.')
    const roundTrip = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(exported, '')
    reimported = roundTrip.scene
    const faceAfter = await fingerprintScanMeshes(reimported, FACE_SCAN_PREFIX)
    const faceLock = await proveFaceLock(faceBefore, faceAfter)
    const exportSha256 = await sha256Hex(exported)
    const createdAt = new Date().toISOString()
    const personalizationReport: PersonalizationReport = {
      createdAt,
      localOnly: true,
      scanFileName: input.scanFile.name,
      scanSha256,
      referencePhoto,
      faceLock,
      bodyFit: {
        target: input.measurements,
        achieved,
        note: 'Body circumference/height values are measurement-guided estimates from the imported base mesh, not tailoring-grade body reconstruction. The supplied face scan vertices are preserved exactly.',
      },
      alignment: input.alignment,
      exportBytes: exported.byteLength,
      exportSha256,
    }
    assembled.userData = { personalization: personalizationReport }
    const blobUrl = URL.createObjectURL(new Blob([exported], { type: 'model/gltf-binary' }))
    return {
      blobUrl,
      glb: exported,
      fileName: `personal-avatar-${exportSha256.slice(0, 12)}.glb`,
      report: personalizationReport,
      source: {
        id: `custom-${exportSha256.slice(0, 16)}`,
        label: 'My exact-face avatar',
        kind: 'custom',
        url: blobUrl,
        format: 'glb',
        pose: 'asset-default',
        integrity: { bytes: exported.byteLength, sha256: exportSha256 },
      },
    }
  } finally {
    if (base) base.dispose()
    if (scanScene) disposeAvatarScene(scanScene)
    if (reimported) disposeAvatarScene(reimported)
    for (const geometry of bakedGeometries) geometry.dispose()
    if (assembled) {
      assembled.traverse((object) => {
        if (object instanceof Mesh && object.name.startsWith('Body_')) object.geometry.dispose()
      })
    }
  }
}
