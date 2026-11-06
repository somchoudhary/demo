import type { AvatarLoadStage } from './types'

export class AvatarLoadError extends Error {
  readonly stage: AvatarLoadStage
  readonly url: string
  readonly resources: string[]

  constructor(stage: AvatarLoadStage, url: string, message: string, options?: { cause?: unknown; resources?: string[] }) {
    super(message, { cause: options?.cause })
    this.name = 'AvatarLoadError'
    this.stage = stage
    this.url = url
    this.resources = options?.resources ?? []
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

export function asAvatarLoadError(error: unknown, stage: AvatarLoadStage, url: string, resources: string[] = []): AvatarLoadError {
  if (error instanceof AvatarLoadError) return error
  const suffix = resources.length ? ` Failed resources: ${[...new Set(resources)].join(', ')}` : ''
  return new AvatarLoadError(stage, url, `${errorMessage(error)}${suffix}`, { cause: error, resources })
}
