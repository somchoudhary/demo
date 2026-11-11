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
import { detectFace } from './faceEngine'
import { buildHeadGroup, computeProfileDepthRatio } from './headReconstruction'
import { loadPhotoCanvas, validatePhotoFile } from './photoInput'
import type { BodyMeasurements, GeneratedAvatar, GenerationProgress, PersonalizationReport, ScanAlignment } from './types'

export interface GenerateAvatarInput {
  /** Optional imported head scan. When omitted, the head is reconstructed locally from both photos. */
  scanFile?: File | null
  /** Front-facing photo: reference alongside a scan, geometry source for photo-only generation. */
  referencePhoto?: File | null
  /** Side-profile photo: required for photo-only generation (profile depth refinement). */
  sidePhoto?: File | null
  photoGeneratedHead?: boolean
  measurements: BodyMeasurements
  alignment: ScanAlignment
  signal?: AbortSignal
  onProgress?: (progress: GenerationProgress) => void
}

const MAX_SCAN_BYTES = 80 * 1024 * 1024
const PHOTO_HEAD_ENGINE = 'fitvision-local-face-engine/v1(face_mesh@0.4.1633559619)'

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

/** Provenance hash for a photo-reconstructed head: both photo bytes + the engine tag. */
function concatForHash(front: ArrayBuffer, side: ArrayBuffer): ArrayBuffer {
  const tag = new TextEncoder().encode(PHOTO_HEAD_ENGINE)
  const combined = new Uint8Array(front.byteLength + side.byteLength + tag.byteLength)
  combined.set(new Uint8Array(front), 0)
  combined.set(new Uint8Array(side), front.byteLength)
  combined.set(tag, front.byteLength + side.byteLength)
  return combined.buffer
}

export async function generatePersonalAvatar(input: GenerateAvatarInput): Promise<GeneratedAvatar> {
  const measurementErrors = validateMeasurements(input.measurements)
  if (measurementErrors.length) throw new Error(measurementErrors.join(' '))
  const alignmentErrors = validateAlignment(input.alignment)
  if (alignmentErrors.length) throw new Error(alignmentErrors.join(' '))
  const usePhotoHead = !input.scanFile
  if (input.scanFile) {
    if (input.scanFile.size > MAX_SCAN_BYTES) throw new Error('Head scan is larger than 80 MB. Export a decimated GLB and try again.')
    const lowerName = input.scanFile.name.toLowerCase()
    if (!lowerName.endsWith('.glb') && !lowerName.endsWith('.gltf')) throw new Error('Head scan must be a self-contained .glb or .gltf file.')
  } else {
    if (!input.referencePhoto || !input.sidePhoto) {
      throw new Error('Photo-only generation needs both a front-facing photo and a side-profile photo.')
    }
  }
  if (input.referencePhoto) validatePhotoFile(input.referencePhoto, 'Front photo')
  if (input.sidePhoto) validatePhotoFile(input.sidePhoto, 'Side photo')

  let base: LoadedAvatar | undefined
  let scanScene: Group | undefined
  let assembled: Group | undefined
  let reimported: Group | undefined
  const bakedGeometries: ReturnType<typeof bakeMesh>[] = []
  const scanSceneMeshes: Mesh[] = []

  try {
    report(input, 'reading-inputs', 'Reading files locally. Nothing is uploaded.')
    throwIfAborted(input.signal)
    const scanBuffer = input.scanFile ? await input.scanFile.arrayBuffer() : undefined
    const frontPhotoBuffer = input.referencePhoto ? await input.referencePhoto.arrayBuffer() : undefined
    const sidePhotoBuffer = input.sidePhoto ? await input.sidePhoto.arrayBuffer() : undefined
    let referencePhoto: PersonalizationReport['referencePhoto']
    if (input.referencePhoto && frontPhotoBuffer) {
      referencePhoto = { fileName: input.referencePhoto.name, sha256: await sha256Hex(frontPhotoBuffer), usedForGeometry: usePhotoHead }
    }
    let sidePhoto: PersonalizationReport['sidePhoto']
    if (input.sidePhoto && sidePhotoBuffer) {
      sidePhoto = { fileName: input.sidePhoto.name, sha256: await sha256Hex(sidePhotoBuffer), usedForGeometry: usePhotoHead }
    }

    report(input, 'loading-base', 'Loading the licensed base human.')
    base = await avatarRepository.load(BASE_AVATAR, { signal: input.signal })
    throwIfAborted(input.signal)

    let headFileName: string
    let headSha256: string
    if (input.scanFile && scanBuffer) {
      report(input, 'validating-scan', 'Validating the imported head scan.')
      const localOnlyManager = new LoadingManager()
      localOnlyManager.setURLModifier((url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url
        throw new Error('Head scan must be self-contained. External texture/buffer URLs are not loaded during local generation.')
      })
      const loader = new GLTFLoader(localOnlyManager).setMeshoptDecoder(MeshoptDecoder)
      const scanGltf = input.scanFile.name.toLowerCase().endsWith('.gltf')
        ? await loader.parseAsync(new TextDecoder().decode(scanBuffer), '')
        : await loader.parseAsync(scanBuffer, '')
      scanScene = scanGltf.scene
      scanScene.traverse((object) => {
        if (object instanceof Mesh) scanSceneMeshes.push(object)
      })
      if (!scanSceneMeshes.length) throw new Error('The head scan contains no renderable mesh.')
      scanSceneMeshes.forEach((mesh, index) => { mesh.name = `${FACE_SCAN_PREFIX}${index}` })
      headFileName = input.scanFile.name
      headSha256 = await sha256Hex(scanBuffer)
    } else {
      if (!input.referencePhoto || !input.sidePhoto || !frontPhotoBuffer || !sidePhotoBuffer) {
        throw new Error('Photo-only generation needs both a front-facing photo and a side-profile photo.')
      }
      report(input, 'detecting-face', 'Detecting the face in both photos with the local engine.')
      const frontCanvas = await loadPhotoCanvas(input.referencePhoto, 'Front photo')
      throwIfAborted(input.signal)
      const sideCanvas = await loadPhotoCanvas(input.sidePhoto, 'Side photo')
      throwIfAborted(input.signal)
      const frontFace = await detectFace(frontCanvas, 'front', input.signal)
      throwIfAborted(input.signal)
      const sideFace = await detectFace(sideCanvas, 'side-profile', input.signal)
      throwIfAborted(input.signal)
      report(input, 'reconstructing-head', 'Reconstructing the 3D head from the front and side views.')
      const depthScale = computeProfileDepthRatio(frontFace, sideFace)
      scanScene = buildHeadGroup(frontFace, frontCanvas, { heightCm: input.measurements.heightCm, depthScale })
      scanScene.updateMatrixWorld(true)
      scanScene.traverse((object) => {
        if (object instanceof Mesh) scanSceneMeshes.push(object)
      })
      headFileName = `photo-reconstruction(${input.referencePhoto.name} + ${input.sidePhoto.name})`
      headSha256 = await sha256Hex(concatForHash(frontPhotoBuffer, sidePhotoBuffer))
    }
    if (!scanSceneMeshes.length) throw new Error('The head model contains no renderable mesh.')
    for (const mesh of scanSceneMeshes) {
      if (mesh instanceof SkinnedMesh) throw new Error('The head model must be a static mesh, not a skinned/rigged character.')
      if (Array.isArray(mesh.material) && mesh.material.length > 1) throw new Error('Please export the head model with one material per mesh.')
      if (Object.keys(mesh.geometry.morphAttributes).length > 0) throw new Error('Please use a static head model without morph targets so the face cannot change.')
    }
    const scanBounds = new Box3().setFromObject(scanScene)
    const scanSize = scanBounds.getSize(new Vector3())
    if (![scanSize.x, scanSize.y, scanSize.z].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Head model bounds are invalid.')
    if (scanSize.y < 0.08 || scanSize.y > 0.8) throw new Error(`Head model height is ${scanSize.y.toFixed(3)} m (expected roughly 0.12–0.60 m).`)
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

    report(input, 'attaching-scan', 'Attaching the head mesh with rigid placement; its local vertices are preserved.')
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

    report(input, 'verifying-face-lock', 'Re-importing the GLB and verifying the head mesh geometry.')
    const roundTrip = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(exported, '')
    reimported = roundTrip.scene
    const faceAfter = await fingerprintScanMeshes(reimported, FACE_SCAN_PREFIX)
    const faceLock = await proveFaceLock(faceBefore, faceAfter)
    const exportSha256 = await sha256Hex(exported)
    const createdAt = new Date().toISOString()
    const personalizationReport: PersonalizationReport = {
      createdAt,
      localOnly: true,
      scanFileName: headFileName,
      scanSha256: headSha256,
      referencePhoto,
      sidePhoto,
      faceLock,
      bodyFit: {
        target: input.measurements,
        achieved,
        note: usePhotoHead
          ? 'Body circumference/height values are measurement-guided estimates from the imported base mesh, not tailoring-grade body reconstruction. The head is a local two-view reconstruction (front mesh + photo texture, side-refined profile); the back of the head, ears and hair are approximations.'
          : 'Body circumference/height values are measurement-guided estimates from the imported base mesh, not tailoring-grade body reconstruction. The head geometry comes from the imported scan.',
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
        label: usePhotoHead ? 'My photo-based avatar' : 'My scanned avatar',
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
