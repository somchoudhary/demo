import { useCallback, useEffect, useState } from 'react'
import { avatarRepository } from './gltfAvatarRepository'
import { asAvatarLoadError } from './errors'
import type { AvatarLoadProgress, AvatarRepository, AvatarSource, LoadedAvatar } from './types'

export type AvatarResource =
  | { status: 'loading'; avatar?: undefined; error?: undefined; progress: AvatarLoadProgress }
  | { status: 'ready'; avatar: LoadedAvatar; error?: undefined; progress?: undefined }
  | { status: 'error'; avatar?: undefined; error: Error; progress?: undefined }

/** Owns cancellation, retry and GPU-resource lifetime; the viewer only consumes the result. */
export function useAvatar(source: AvatarSource, repository: AvatarRepository = avatarRepository) {
  const [attempt, setAttempt] = useState(0)
  const [resource, setResource] = useState<AvatarResource>({ status: 'loading', progress: { stage: 'request', loadedBytes: 0 } })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let loaded: LoadedAvatar | undefined
    setResource({ status: 'loading', progress: { stage: 'request', loadedBytes: 0 } })
    repository.load(source, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (active) setResource({ status: 'loading', progress })
      },
    }).then((avatar) => {
      if (!active) {
        avatar.dispose()
        return
      }
      loaded = avatar
      setResource({ status: 'ready', avatar })
    }).catch((error: unknown) => {
      if (active) setResource({ status: 'error', error: asAvatarLoadError(error, 'request', source.url) })
    })
    return () => {
      active = false
      controller.abort()
      loaded?.dispose()
    }
  }, [source, repository, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { resource, retry }
}
