import { Material, Mesh, Object3D, SkinnedMesh, Texture } from 'three'

/** Release GPU resources owned by a loaded avatar, including shared maps and ImageBitmaps. */
export function disposeAvatarScene(root: Object3D): void {
  const geometries = new Set<Mesh['geometry']>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<SkinnedMesh['skeleton']>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const list = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of list) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton)
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  skeletons.forEach((skeleton) => skeleton.dispose())
  textures.forEach((texture) => {
    texture.dispose()
    const image = texture.image
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
  })
  root.clear()
}
