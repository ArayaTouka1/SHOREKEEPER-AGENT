import type { Object3D, Mesh, Material, Texture, BufferGeometry, Skeleton } from 'three'

/** Release shared resources once; renderer.dispose alone does not release a model. */
export function disposeModel(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const skeletons = new Set<Skeleton>()
  root.traverse((node) => {
    const mesh = node as Mesh & { skeleton?: Skeleton }
    if (!mesh.isMesh) return
    geometries.add(mesh.geometry)
    if (mesh.skeleton) skeletons.add(mesh.skeleton)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as Texture).isTexture) textures.add(value as Texture)
      }
    }
  })
  skeletons.forEach((skeleton) => skeleton.dispose())
  textures.forEach((texture) => texture.dispose())
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
  root.removeFromParent()
}
