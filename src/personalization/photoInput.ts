/**
 * Photo input decoding for the local reconstruction engine.
 * Files are decoded with createImageBitmap and drawn to canvases entirely in
 * this browser; nothing is uploaded anywhere.
 */

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
/** Longest side of the working canvas: sharp enough for landmarks + texture. */
export const PHOTO_WORKING_SIZE = 1280
const MIN_PHOTO_SIDE = 320

export function validatePhotoFile(file: File, label: string): void {
  if (file.size > MAX_PHOTO_BYTES) throw new Error(`${label} is larger than 15 MB.`)
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    throw new Error(`${label} must be PNG, JPEG or WebP.`)
  }
}

/** Decode a photo file into a canvas, downscaling only if it exceeds the working size. */
export async function loadPhotoCanvas(file: File, label: string): Promise<HTMLCanvasElement> {
  validatePhotoFile(file, label)
  const bitmap = await createImageBitmap(file)
  try {
    if (Math.min(bitmap.width, bitmap.height) < MIN_PHOTO_SIDE) {
      throw new Error(
        `${label} is ${bitmap.width}×${bitmap.height} px. Use a sharper photo at least ${MIN_PHOTO_SIDE}×${MIN_PHOTO_SIDE} px with the face filling most of the frame.`,
      )
    }
    const scale = Math.min(1, PHOTO_WORKING_SIZE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Could not prepare the photo for face detection in this browser.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas
  } finally {
    bitmap.close()
  }
}
