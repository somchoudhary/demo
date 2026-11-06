import manifest from './asset-manifest.json'
import type { AvatarSource } from './types'

/** Locally bundled, openly licensed MPFB reference human. Not a user likeness. */
export const BASE_AVATAR: AvatarSource = {
  id: manifest.id,
  label: manifest.name,
  kind: 'base',
  url: manifest.url,
  format: 'glb',
  pose: 'neutral-standing',
  integrity: {
    bytes: manifest.bytes,
    sha256: manifest.sha256,
  },
}

export const ASSET_PROVENANCE = {
  author: 'Mika Suominen (met4citizen)',
  createdWith: 'Blender + MPFB / MakeHuman',
  license: 'CC0 1.0 Universal',
  licenseFile: manifest.licenseUrl,
  manifest: '/models/base-avatar.manifest.json',
  sourceUrl: manifest.source.url,
  sourceSha256: manifest.source.sha256,
} as const
