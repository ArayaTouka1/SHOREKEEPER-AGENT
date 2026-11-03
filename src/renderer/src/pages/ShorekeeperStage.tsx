import React, { useEffect, useRef } from 'react'
import type { CallRenderConfig } from '../../../shared/types'
import type { Live2DInfo } from './CallWindow'
import mouthMorphData from '../assets/shorekeeper-mouth-morphs.json'
import { disposeModel } from '../utils/disposeModel'

type Props = {
  info: Live2DInfo
  speaking: boolean
  lipSyncProgress: number
  lipSyncAmplitude: React.MutableRefObject<number>
  onReady: () => void
  onError: (message: string) => void
  renderConfig: CallRenderConfig
}

/** The external Blender export uses the same rig as the bundled Stand1 clip. */
export default function ShorekeeperStage({ info, speaking, lipSyncProgress, lipSyncAmplitude, onReady, onError, renderConfig }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const speakingRef = useRef(speaking)
  const progressRef = useRef(lipSyncProgress)
  const renderRef = useRef(renderConfig)
  useEffect(() => { speakingRef.current = speaking }, [speaking])
  useEffect(() => { progressRef.current = lipSyncProgress }, [lipSyncProgress])
  useEffect(() => { renderRef.current = renderConfig }, [renderConfig])

  useEffect(() => {
    let disposed = false
    let frame = 0
    let observer: ResizeObserver | undefined
    let renderer: import('three').WebGLRenderer | undefined
    let sceneModel: import('three').Object3D | undefined
    let mixer: import('three').AnimationMixer | undefined
    const ramps: import('three').DataTexture[] = []
    const recoveredTextures: import('three').Texture[] = []
    const host = hostRef.current
    if (!host) return
    void (async () => {
      try {
        const THREE = await import('three')
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        if (disposed) return
        const loader = new GLTFLoader()
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(32, 1, 1, 100)
        const ambient = new THREE.HemisphereLight(0xffffff, 0x8291aa, 0.12)
        const key = new THREE.DirectionalLight(0xffffff, 0.28)
        const fill = new THREE.DirectionalLight(0xb7d9ff, 0.09)
        const rim = new THREE.DirectionalLight(0xaccfff, 0.12)
        const face = new THREE.DirectionalLight(0xffffff, 0.08)
        key.position.set(-2, 5, 6)
        fill.position.set(4, 2, -3)
        rim.position.set(1, 4, -5)
        face.position.set(0, 1, 5)
        scene.add(ambient, key, fill, rim, face)
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        // The source .blend uses Standard with exposure 0 and gamma 1.
        renderer.toneMapping = THREE.LinearToneMapping
        renderer.setClearColor(0, 0)
        host.appendChild(renderer.domElement)

        const gltf = await loader.loadAsync(info.modelUrl)
        if (disposed) { disposeModel(gltf.scene); return }
        sceneModel = gltf.scene
        scene.add(sceneModel)
        const parser = gltf.parser as unknown as {
          json: {
            materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]
            textures?: { source?: number }[]
            images?: { bufferView?: number; mimeType?: string }[]
          }
          getDependency(type: string, index: number): Promise<ArrayBuffer>
        }
        const textureCache = new Map<number, import('three').Texture>()
        const recoverTexture = async (name: string): Promise<import('three').Texture> => {
          const material = parser.json.materials?.find((item) => item.name === name)
          const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index
          const imageIndex = textureIndex === undefined ? undefined : parser.json.textures?.[textureIndex]?.source
          const image = imageIndex === undefined ? undefined : parser.json.images?.[imageIndex]
          if (imageIndex === undefined || image?.bufferView === undefined) {
            throw new Error(`模型材质缺少内嵌贴图：${name}`)
          }
          const cached = textureCache.get(imageIndex)
          if (cached) return cached
          const bytes = await parser.getDependency('bufferView', image.bufferView)
          // GLTFLoader's ImageBitmapLoader can silently return null for blob:
          // URLs in Electron's appfile origin. Decode the embedded PNG through
          // an image data URL so the texture is available before rendering.
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error || new Error('无法读取模型贴图'))
            reader.readAsDataURL(new Blob([bytes], { type: image.mimeType || 'image/png' }))
          })
          const element = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = () => reject(new Error(`无法解码模型贴图：${name}`))
            img.src = dataUrl
          })
          if (disposed) throw new Error('模型已关闭')
          const texture = new THREE.Texture(element)
          texture.flipY = false
          texture.colorSpace = THREE.SRGBColorSpace
          texture.anisotropy = Math.min(renderer?.capabilities.getMaxAnisotropy() || 1, 8)
          texture.needsUpdate = true
          textureCache.set(imageIndex, texture)
          recoveredTextures.push(texture)
          return texture
        }
        const makeRamp = (name: string): import('three').DataTexture => {
          // These shadow and midtone colors come from the constant color ramps
          // in the Blender project's Bangs, Hair, Up, Down and Alpha materials.
          const shadow = /Bangs|Hair/i.test(name) ? [0.52, 0.6, 0.82]
            : /Down/i.test(name) ? [0.72, 0.6, 0.63]
              : /Alpha/i.test(name) ? [0.66, 0.72, 0.9]
                : /Up02/i.test(name) ? [0.58, 0.64, 0.84] : [0.62, 0.68, 0.86]
          const midtone = /Bangs|Hair/i.test(name) ? [0.78, 0.83, 0.95]
            : /Down/i.test(name) ? [0.87, 0.8, 0.8]
              : /Alpha/i.test(name) ? [0.85, 0.89, 0.98]
                : /Up02/i.test(name) ? [0.8, 0.85, 0.96] : [0.82, 0.86, 0.96]
          const data = new Uint8Array([...shadow, 1, ...midtone, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((value) => Math.round(value * 255)))
          const ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat)
          ramp.magFilter = THREE.NearestFilter
          ramp.minFilter = THREE.NearestFilter
          ramp.needsUpdate = true
          ramps.push(ramp)
          return ramp
        }
        const mouthMorphs: { mesh: import('three').Mesh; indices: number[] }[] = []
        const meshes: import('three').Mesh[] = []
        sceneModel.traverse((node) => {
          const mesh = node as import('three').Mesh
          if (mesh.isMesh) meshes.push(mesh)
        })
        for (const mesh of meshes) {
          const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const toon = await Promise.all(originals.map(async (original) => {
            const source = original as import('three').MeshStandardMaterial
            const map = source.map || await recoverTexture(source.name)
            const cutout = /Alpha_Call/i.test(source.name)
            const material = new THREE.MeshToonMaterial({
              map,
              color: source.color,
              gradientMap: makeRamp(source.name),
              // The Blender shader is emissive: the painted texture remains
              // visible even in shade. Strong direct lights washed it white.
              emissive: 0xffffff,
              emissiveMap: map,
              emissiveIntensity: 0.68,
              transparent: cutout ? false : source.transparent,
              alphaTest: cutout ? 0.24 : source.alphaTest,
              opacity: source.opacity,
              side: source.side,
              vertexColors: source.vertexColors,
              depthWrite: cutout ? true : source.depthWrite,
              skinning: true
            } as import('three').MeshToonMaterialParameters)
            material.name = source.name
            original.dispose()
            return material
          }))
          if (disposed) { toon.forEach(material => material.dispose()); return }
          mesh.material = Array.isArray(mesh.material) ? toon : toon[0]
          if (originals.some((material) => /Face_Call/i.test(material.name))) {
            const geometry = mesh.geometry
            const positions = geometry.getAttribute('position')
            const previous = mesh.morphTargetInfluences?.slice() || []
            const indices: number[] = []
            for (const vowel of ['あ', 'い', 'う', 'え', 'お'] as const) {
              const deltas = new Float32Array(positions.count * 3)
              for (const [index, x, y, z] of mouthMorphData[vowel]) {
                if (index >= positions.count) continue
                deltas[index * 3] = x
                deltas[index * 3 + 1] = y
                deltas[index * 3 + 2] = z
              }
              const attribute = new THREE.Float32BufferAttribute(deltas, 3)
              attribute.name = vowel
              indices.push(geometry.morphAttributes.position.length)
              geometry.morphAttributes.position.push(attribute)
              if (geometry.morphAttributes.normal?.length) {
                geometry.morphAttributes.normal.push(new THREE.Float32BufferAttribute(new Float32Array(positions.count * 3), 3))
              }
            }
            mesh.updateMorphTargets()
            previous.forEach((value, index) => { mesh.morphTargetInfluences![index] = value })
            mouthMorphs.push({ mesh, indices })
          }
        }

        const box = new THREE.Box3().setFromObject(sceneModel)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const height = Math.max(size.y, 0.1)
        const fit = (): void => {
          if (!renderer || !host) return
          const width = Math.max(host.clientWidth, 1)
          const viewportHeight = Math.max(host.clientHeight, 1)
          renderer.setSize(width, viewportHeight, false)
          camera.aspect = width / viewportHeight
          camera.position.set(center.x, center.y + height * 0.315, center.z + height * 0.8)
          camera.lookAt(center.x, center.y + height * 0.335, center.z)
          camera.near = Math.max(1, height * 0.025)
          // Blender exports this rig at roughly 156 units tall. The portrait
          // camera sits farther than the original 100-unit far plane, which
          // clipped the entire model even though loading had succeeded.
          camera.far = Math.max(100, height * 4, camera.position.distanceTo(center) + size.length())
          camera.updateProjectionMatrix()
        }
        fit()
        observer = new ResizeObserver(fit)
        observer.observe(host)

        if (info.idleMotionUrl) {
          try {
            const motion = await loader.loadAsync(info.idleMotionUrl)
            const clip = motion.animations[0]
            disposeModel(motion.scene)
            if (disposed) return
            if (clip?.tracks.length) {
              mixer = new THREE.AnimationMixer(sceneModel)
              mixer.clipAction(clip).play()
            }
          } catch (error) {
            console.warn('守岸人待机动作加载失败:', error)
          }
        }
        onReady()
        const clock = new THREE.Clock()
        let mouthLevel = 0
        const animate = (): void => {
          if (disposed || !renderer) return
          frame = window.requestAnimationFrame(animate)
          const config = renderRef.current
          ambient.intensity = 0.12 * config.ambientLight * (1 - config.shadowStrength * 0.3)
          key.intensity = 0.28 * config.light * config.keyLight
          fill.intensity = 0.09 * config.light * config.fillLight
          rim.intensity = 0.12 * config.light * config.rimLight
          face.intensity = 0.08 * config.light * config.faceLight
          renderer.toneMappingExposure = config.exposure
          mixer?.update(Math.min(clock.getDelta(), 0.1))
          const audioLevel = Math.max(0, Math.min(1, lipSyncAmplitude.current))
          const fallback = 0.12 + 0.3 * Math.abs(Math.sin(clock.elapsedTime * 10 + progressRef.current * 8))
          const targetMouth = speakingRef.current ? Math.max(audioLevel, fallback) : 0
          mouthLevel += (targetMouth - mouthLevel) * (targetMouth > mouthLevel ? 0.48 : 0.16)
          const vowelIndex = Math.floor(Math.max(0, progressRef.current) * 24) % 5
          for (const { mesh, indices } of mouthMorphs) {
            indices.forEach((index, order) => {
              mesh.morphTargetInfluences![index] = Math.min(1, mouthLevel * 1.5) * (order === vowelIndex ? 1 : 0.025)
            })
          }
          renderer.render(scene, camera)
        }
        animate()
      } catch (error) {
        if (!disposed) onError(error instanceof Error ? error.message : '守岸人模型加载失败')
      }
    })()
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      mixer?.stopAllAction()
      if (sceneModel) { mixer?.uncacheRoot(sceneModel); disposeModel(sceneModel) }
      ramps.forEach((ramp) => ramp.dispose())
      recoveredTextures.forEach((texture) => texture.dispose())
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
    }
  }, [info.modelUrl, info.idleMotionUrl, onReady, onError])
  return <div ref={hostRef} className="live-call-model-stage" aria-label={`${info.modelName} 三维模型`} />
}
