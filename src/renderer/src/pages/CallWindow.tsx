import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Phone, PhoneOff } from 'lucide-react'
import { useApp } from '../store/AppStore'
import { useSpeech } from '../hooks/useSpeech'
import { toLocalUrl } from '../utils/localUrl'
import { transcribeLocalSpeech, cancelLocalSpeechRecognition } from '../services/localSpeechRecognition'
import { selectAudioOutput } from '../utils/audioOutput'
import { defaultCallRender, callRenderKey, callRenderStyle } from '../utils/callRender'
import CallBackground from '../components/CallBackground'
import ShorekeeperStage from './ShorekeeperStage'
import { disposeModel } from '../utils/disposeModel'
import { createMmdWorld, type PhysicsResources } from '../utils/mmdResources'
import type { CallRenderConfig } from '../../../shared/types'
import type { Application } from 'pixi.js'
import ammoScriptUrl from 'three/examples/jsm/libs/ammo.wasm.js?url'
import ammoWasmUrl from 'three/examples/jsm/libs/ammo.wasm.wasm?url'

export type Live2DInfo = { modelUrl: string; coreUrl: string; shaderUrl: string; modelName: string; missingCore: boolean; format: 'cubism' | 'mmd-pmx' | 'gltf'; idleMotionUrl?: string; talkMotionUrl?: string }

let ammoPhysicsPromise: Promise<boolean> | null = null

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer = 0
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), milliseconds) })
  ]).finally(() => window.clearTimeout(timer))
}

async function ensureMmdPhysicsRuntime(): Promise<boolean> {
  if (!ammoPhysicsPromise) {
    ammoPhysicsPromise = (async () => {
      const runtimeWindow = window as Window & {
        Ammo?: ((options?: { locateFile?: (path: string) => string }) => Promise<Record<string, unknown>>) | Record<string, unknown>
      }
      const isAmmoModule = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && 'btVector3' in value
      if (isAmmoModule(runtimeWindow.Ammo)) return true

      if (typeof runtimeWindow.Ammo !== 'function') {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = ammoScriptUrl
          script.dataset.mmdAmmo = 'true'
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Ammo.js 加载失败'))
          document.head.appendChild(script)
        })
      }

      const ammoFactory = runtimeWindow.Ammo
      if (typeof ammoFactory !== 'function') return false
      const ammoModule = await ammoFactory({ locateFile: (path) => path.endsWith('.wasm') ? ammoWasmUrl : path })
      runtimeWindow.Ammo = ammoModule
      return isAmmoModule(ammoModule)
    })().catch((error: unknown) => {
      console.warn('MMD physics runtime is unavailable; continuing without physics:', error)
      return false
    })
  }
  return ammoPhysicsPromise
}

async function waitForCoreReady(): Promise<void> {
  const deadline = Date.now() + 20000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const core = (window as Window & { Live2DCubismCore?: { Version?: { csmGetVersion?: () => number } } }).Live2DCubismCore
      const version = core?.Version?.csmGetVersion?.()
      if (typeof version === 'number' && version > 0) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  throw new Error(lastError instanceof Error ? `Core 初始化超时：${lastError.message}` : 'Core 初始化超时（检查网络连接）')
}

function loadCoreScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-live2d-core]')
    if (existing?.dataset.src === url && existing.dataset.loaded === 'true') {
      void waitForCoreReady().then(resolve, reject)
      return
    }
    if (existing) existing.remove()
    const script = document.createElement('script')
    script.src = url
    script.dataset.live2dCore = 'true'
    script.dataset.src = url
    script.onload = () => {
      script.dataset.loaded = 'true'
      void waitForCoreReady().then(resolve, reject)
    }
    script.onerror = () => reject(new Error('Cubism Core 加载失败，请检查所选运行时文件'))
    document.head.appendChild(script)
  })
}

export function Live2DStage({ info, speaking, lipSyncProgress, lipSyncAmplitude, onReady, onError }: { info: Live2DInfo; speaking: boolean; lipSyncProgress: number; lipSyncAmplitude: React.MutableRefObject<number>; onReady: () => void; onError: (message: string) => void }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const speakingRef = useRef(speaking)
  const lipSyncProgressRef = useRef(lipSyncProgress)
  const modelRef = useRef<{ internalModel?: { coreModel?: { setParameterValueById(id: string, value: number): void; addParameterValueById(id: string, value: number, weight?: number): void }; settings?: { motions?: Record<string, unknown[]>; getLipSyncParameterCount?: () => number; getLipSyncParameterId?: (index: number) => { getString?: () => string } | null } }; motion?: (group: string, index?: number, priority?: number) => Promise<boolean> } | null>(null)
  useEffect(() => { lipSyncProgressRef.current = lipSyncProgress }, [lipSyncProgress])
  useEffect(() => { speakingRef.current = speaking }, [speaking])
  useEffect(() => {
    let disposed = false
    let app: Application | null = null
    let resizeObserver: ResizeObserver | null = null
    void (async () => {
      try {
        await loadCoreScript(info.coreUrl)
        await import('pixi.js/unsafe-eval')
        const PIXI = await import('pixi.js')
        ;(window as Window & { PIXI?: typeof PIXI }).PIXI = PIXI
        const { Live2DModel } = await import('@laplace.live/pixijs-live2d')
        Live2DModel.registerTicker(PIXI.Ticker)
        const host = hostRef.current
        if (!host || disposed) return
        app = new PIXI.Application()
        await app.init({
          width: host.clientWidth,
          height: host.clientHeight,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          preference: 'webgl',
          preferWebGLVersion: 2
        })
        if (disposed) { app.destroy({ removeView: true }); return }
        host.appendChild(app.canvas)
        const model = await Live2DModel.from(info.modelUrl)
        if (disposed) { app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true }); return }
        modelRef.current = model as unknown as typeof modelRef.current
        // Keep Cubism updates and our subtle idle/lip-sync parameters on the same ticker.
        model.automator.ticker = app.ticker
        model.anchor.set(0, 0)
        const renderer = (model as unknown as { internalModel?: { renderer?: { drawModel?: (shaderPath?: string) => void } } }).internalModel?.renderer
        if (renderer?.drawModel) {
          const drawModel = renderer.drawModel.bind(renderer)
          renderer.drawModel = () => drawModel(info.shaderUrl)
        }
        app.stage.addChild(model)
        const fit = (): void => {
          if (!app || !host) return
          app.renderer.resize(host.clientWidth, host.clientHeight)
          const bounds = model.getLocalBounds()
          // Keep the full head visible while retaining a close, natural upper-body portrait.
          const scale = host.clientHeight / Math.max(bounds.height * 0.29, 1)
          model.scale.set(scale)
          const headroom = bounds.height * 0.055
          model.position.set(host.clientWidth / 2 - (bounds.x + bounds.width / 2) * scale, host.clientHeight * 0.075 - (bounds.y - headroom) * scale)
        }
        fit()
        resizeObserver = new ResizeObserver(fit)
        resizeObserver.observe(host)
        const modelApi = model as unknown as NonNullable<typeof modelRef.current>
        const motionGroups = Object.keys(modelApi.internalModel?.settings?.motions ?? {})
          .filter((group) => !/tap|hit|touch|click/i.test(group))
        let stopMotions = (): void => {}
        const startTime = performance.now()
        let gazeX = 0
        let gazeY = 0
        let targetGazeX = 0
        let targetGazeY = 0
        let gestureActive = false
        let gestureAngleX = 0
        let gestureAngleY = 0
        let gestureAngleZ = 0
        let gestureShoulderL = 0
        let gestureShoulderR = 0
        let targetGestureAngleX = 0
        let targetGestureAngleY = 0
        let targetGestureAngleZ = 0
        let targetShoulderL = 0
        let targetShoulderR = 0
        let nextGestureChange = startTime + 1800
        const updateIdleAndMouth = (): void => {
          const now = performance.now()
          const elapsed = (now - startTime) / 1000
          const internal = modelApi.internalModel
          const core = internal?.coreModel
          if (!core) return

          // Models without authored motions still breathe, glance around, and gently sway.
          if (!motionGroups.length) {
            if (now >= nextGestureChange) {
              gestureActive = !gestureActive
              if (gestureActive) {
                targetGazeX = (Math.random() - 0.5) * 1.1
                targetGazeY = (Math.random() - 0.5) * 0.65
                targetGestureAngleX = (Math.random() - 0.5) * 8
                targetGestureAngleY = (Math.random() - 0.5) * 4
                targetGestureAngleZ = (Math.random() - 0.5) * 3.6
                targetShoulderL = Math.random() > 0.55 ? (Math.random() - 0.5) * 8 : 0
                targetShoulderR = targetShoulderL === 0 ? (Math.random() - 0.5) * 8 : 0
                nextGestureChange = now + 1100 + Math.random() * 900
              } else {
                targetGazeX = 0
                targetGazeY = 0
                targetGestureAngleX = 0
                targetGestureAngleY = 0
                targetGestureAngleZ = 0
                targetShoulderL = 0
                targetShoulderR = 0
                nextGestureChange = now + 3600 + Math.random() * 4600
              }
            }
            const ease = 0.012
            gazeX += (targetGazeX - gazeX) * ease
            gazeY += (targetGazeY - gazeY) * ease
            gestureAngleX += (targetGestureAngleX - gestureAngleX) * ease
            gestureAngleY += (targetGestureAngleY - gestureAngleY) * ease
            gestureAngleZ += (targetGestureAngleZ - gestureAngleZ) * ease
            gestureShoulderL += (targetShoulderL - gestureShoulderL) * ease
            gestureShoulderR += (targetShoulderR - gestureShoulderR) * ease
            core.setParameterValueById('ParamAngleX', Math.sin(elapsed * 0.36) * 2.0 + gestureAngleX)
            core.setParameterValueById('ParamAngleY', Math.sin(elapsed * 0.27 + 0.5) * 1.1 + gestureAngleY)
            core.setParameterValueById('ParamAngleZ', Math.sin(elapsed * 0.22 + 1.1) * 1.15 + gestureAngleZ)
            core.setParameterValueById('ParamBodyAngleX', Math.sin(elapsed * 0.19) * 1.35 + gestureAngleX * 0.18)
            core.setParameterValueById('ParamBreath', 0.48 + Math.sin(elapsed * 1.35) * 0.14)
            core.setParameterValueById('ParamEyeBallX', gazeX)
            core.setParameterValueById('ParamEyeBallY', gazeY)
            core.setParameterValueById('ParamShoulderLRotation', gestureShoulderL)
            core.setParameterValueById('ParamShoulderRRotation', gestureShoulderR)
          }

          const talking = speakingRef.current
          const progress = lipSyncProgressRef.current
          const wave = Math.max(0, Math.sin(elapsed * 12 + progress * 5) * 0.56 + Math.sin(elapsed * 7.2 + 1.2) * 0.3 + Math.sin(elapsed * 18 + 0.4) * 0.2)
          const audioLevel = lipSyncAmplitude.current
          const mouthMovement = audioLevel > 0.015 ? Math.min(1, audioLevel * 1.8) : wave * (0.42 + Math.min(1, progress * 2) * 0.35)
          const mouth = talking ? 0.04 + mouthMovement * 0.9 : 0
          const lipSyncCount = internal?.settings?.getLipSyncParameterCount?.() ?? 0
          if (lipSyncCount > 0) {
            for (let index = 0; index < lipSyncCount; index += 1) {
              const id = internal?.settings?.getLipSyncParameterId?.(index)?.getString?.()
              if (id) core.setParameterValueById(id, mouth)
            }
          } else core.setParameterValueById('ParamMouthOpenY', mouth)
          core.setParameterValueById('ParamMouthForm', talking ? 0.06 : 0)
        }
        app.ticker.add(updateIdleAndMouth, undefined, PIXI.UPDATE_PRIORITY.LOW + 1)
        if (motionGroups.length && modelApi.motion) {
          let stopped = false
          let timer = 0
          const playIdleMotion = async (): Promise<void> => {
            if (stopped) return
            const group = motionGroups.find((name) => /idle|待机|闲置/i.test(name)) ?? motionGroups[0]
            const motions = modelApi.internalModel?.settings?.motions?.[group] ?? []
            if (motions.length) {
              const index = Math.floor(Math.random() * motions.length)
              try { await modelApi.motion?.(group, index, 1) } catch { /* Motion is optional for custom models. */ }
            }
            timer = window.setTimeout(() => { void playIdleMotion() }, 6500 + Math.random() * 5000)
          }
          timer = window.setTimeout(() => { void playIdleMotion() }, 1800 + Math.random() * 2200)
          stopMotions = (): void => { stopped = true; window.clearTimeout(timer) }
        }
        ;(model as unknown as { __callMotionCleanup?: () => void }).__callMotionCleanup = () => {
          app?.ticker.remove(updateIdleAndMouth)
          stopMotions()
        }
        onReady()
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Live2D 模型加载失败')
      }
    })()
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      ;(modelRef.current as unknown as { __callMotionCleanup?: () => void } | null)?.__callMotionCleanup?.()
      modelRef.current = null
      app?.destroy({ removeView: true }, { children: true, texture: true, textureSource: true })
    }
  }, [info.coreUrl, info.modelUrl, info.shaderUrl, onError, onReady])
  return <div ref={hostRef} className="live-call-model-stage" aria-label={`${info.modelName} Live2D 模型`} />
}

export function MmdStage({ info, speaking, lipSyncProgress, lipSyncAmplitude, speechBoundary, onReady, onError, renderConfig }: { info: Live2DInfo; speaking: boolean; lipSyncProgress: number; lipSyncAmplitude: React.MutableRefObject<number>; speechBoundary: React.MutableRefObject<number>; onReady: () => void; onError: (message: string) => void; renderConfig: CallRenderConfig }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const speakingRef = useRef(speaking)
  const progressRef = useRef(lipSyncProgress)
  const renderRef = useRef(renderConfig)
  useEffect(() => { speakingRef.current = speaking }, [speaking])
  useEffect(() => { progressRef.current = lipSyncProgress }, [lipSyncProgress])
  useEffect(() => { renderRef.current = renderConfig }, [renderConfig])

  useEffect(() => {
    let disposed = false
    let renderer: import('three').WebGLRenderer | null = null
    let motionHelper: import('three/examples/jsm/animation/MMDAnimationHelper.js').MMDAnimationHelper | null = null
    let sceneModel: import('three').SkinnedMesh | null = null
    let physicsWorld: ReturnType<typeof createMmdWorld> | undefined
    let physicsResources: PhysicsResources | undefined
    let idleAction: import('three').AnimationAction | null = null
    let talkAction: import('three').AnimationAction | null = null
    let resizeObserver: ResizeObserver | null = null
    let frame = 0
    void (async () => {
      try {
        const THREE = await import('three')
        const { MMDLoader } = await import('three/examples/jsm/loaders/MMDLoader.js')
        const { MMDAnimationHelper } = await import('three/examples/jsm/animation/MMDAnimationHelper.js')
        const host = hostRef.current
        if (!host || disposed) return
        const scene = new THREE.Scene()
        scene.background = null
        const ambientLight = new THREE.HemisphereLight(0xf4f8ff, 0x696b82, 1.35)
        scene.add(ambientLight)
        const keyLight = new THREE.DirectionalLight(0xfff4e8, 2.0)
        keyLight.position.set(-2, 5, 6)
        scene.add(keyLight)
        const fillLight = new THREE.DirectionalLight(0xb7d9ff, 0.8)
        fillLight.position.set(4, 2, -3)
        scene.add(fillLight)
        const rimLight = new THREE.DirectionalLight(0x8bdfff, 1.45)
        rimLight.position.set(1, 4, -5)
        scene.add(rimLight)
        const faceLight = new THREE.DirectionalLight(0xffe7f0, 0.55)
        faceLight.position.set(0, 1, 5)
        scene.add(faceLight)
        const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 5000)
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = renderRef.current.exposure
        renderer.setClearColor(0x000000, 0)
        host.appendChild(renderer.domElement)

        let model: import('three').SkinnedMesh | null = null
        let boundsHeight = 1
        let lastSpeechGestureAt = 0
        let speechGestureStartedAt = -Infinity
        let gestureSide: 'left' | 'right' | null = null
        let nextGestureSide: 'left' | 'right' = 'right'
        let smoothedSpeechLevel = 0
        let voiceWasActive = false
        let gestureStrength = 0.75
        let mouthEnvelope = 0
        let lastSpeechBoundary = 0
        let blinkMorphIndex = -1
        let smileMorphIndex = -1
        let mouthMorphIndices: Array<{ index: number; weight: number }> = []
        let nextBlink = performance.now() + 3500
        let blinkStarted = 0
        let headBone: import('three').Bone | undefined
        let neckBone: import('three').Bone | undefined
        let torsoBone: import('three').Bone | undefined
        let leftShoulderBone: import('three').Bone | undefined
        let rightShoulderBone: import('three').Bone | undefined
        let leftArmBone: import('three').Bone | undefined
        let rightArmBone: import('three').Bone | undefined
        let leftElbowBone: import('three').Bone | undefined
        let rightElbowBone: import('three').Bone | undefined
        let leftWristBone: import('three').Bone | undefined
        let rightWristBone: import('three').Bone | undefined
        let originalRotations = new Map<import('three').Bone, import('three').Euler>()

        const fit = (): void => {
          if (!renderer || !host) return
          const width = Math.max(1, host.clientWidth)
          const height = Math.max(1, host.clientHeight)
          renderer.setSize(width, height, false)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
          if (!model) return
          const bounds = new THREE.Box3().setFromObject(model)
          const size = bounds.getSize(new THREE.Vector3())
          const center = bounds.getCenter(new THREE.Vector3())
          boundsHeight = Math.max(size.y, 0.01)
          // Natural close call framing with extra headroom and the waist below the frame.
          camera.position.set(center.x, center.y + boundsHeight * 0.32, center.z + boundsHeight * 0.64)
          camera.lookAt(center.x, center.y + boundsHeight * 0.40, center.z)
        }

        const loader = new MMDLoader()
        model = await withTimeout(loader.loadAsync(info.modelUrl), 45000, 'MMD 模型文件加载超时，请检查模型和贴图路径')
        if (disposed) { disposeModel(model); return }
        sceneModel = model
        scene.add(model)
        // Keep the authored PMX textures/toon ramps while lifting dull MMD
        // materials slightly; MMDLoader's toon ramp continues to define cel shading.
        model.traverse((node) => {
          const mesh = node as import('three').Mesh
          if (!mesh.isMesh) return
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            const phong = material as import('three').MeshPhongMaterial
            if ('shininess' in phong) phong.shininess = Math.max(phong.shininess || 0, 18)
            material.needsUpdate = true
          }
        })
        const bones = model.skeleton.bones
        headBone = bones.find((bone) => /頭|head/i.test(bone.name))
        neckBone = bones.find((bone) => /首|neck/i.test(bone.name))
        torsoBone = bones.find((bone) => /上半身|胸|torso|upper.?body/i.test(bone.name))
        leftShoulderBone = bones.find((bone) => /左肩|left.?shoulder/i.test(bone.name))
        rightShoulderBone = bones.find((bone) => /右肩|right.?shoulder/i.test(bone.name))
        leftArmBone = bones.find((bone) => /^左腕$|left.?arm/i.test(bone.name))
        rightArmBone = bones.find((bone) => /^右腕$|right.?arm/i.test(bone.name))
        leftElbowBone = bones.find((bone) => /左(?:ひじ|肘)|left.?elbow/i.test(bone.name))
        rightElbowBone = bones.find((bone) => /右(?:ひじ|肘)|right.?elbow/i.test(bone.name))
        leftWristBone = bones.find((bone) => /左手首|left.?wrist/i.test(bone.name))
        rightWristBone = bones.find((bone) => /右手首|right.?wrist/i.test(bone.name))
        originalRotations = new Map(bones.map((bone) => [bone, bone.rotation.clone()]))
        // The model ships in a wide open-arm pose. Ease into a compact, relaxed pose
        // that keeps both hands in the close-call frame near the chin and collar.
        const restPose = {
          leftShoulder: -0.08,
          rightShoulder: 0.08,
          leftArm: -0.72,
          rightArm: 0.72,
          leftElbow: -0.92,
          rightElbow: 0.92,
          leftWrist: 0.12,
          rightWrist: -0.12
        }
        const morphs = model.morphTargetDictionary ?? {}
        const morphEntries = Object.entries(morphs)
        const vowelWeights = new Map([['あ', 1], ['い', 0.68], ['う', 0.46], ['え', 0.72], ['お', 0.9]])
        mouthMorphIndices = morphEntries.flatMap(([name, index]) => {
          const weight = vowelWeights.get(name.trim())
          return weight === undefined ? [] : [{ index, weight }]
        })
        const mouthEntry = morphEntries.find(([name]) => /口.*(?:開|あ)|(?:mouth|lip).*(?:open|a)|^あ$/i.test(name))
          ?? morphEntries.find(([name]) => /口|mouth|lip/i.test(name))
          ?? morphEntries.find(([name]) => /^[あぁアァ]$/.test(name))
        const blinkEntry = morphEntries.find(([name]) => /まばたき|目閉|blink/i.test(name))
        const smileEntry = morphEntries.find(([name]) => /にこり|にやり|笑い|smile|happy/i.test(name))
        if (mouthMorphIndices.length === 0 && mouthEntry) mouthMorphIndices = [{ index: mouthEntry[1], weight: 1 }]
        blinkMorphIndex = blinkEntry?.[1] ?? -1
        smileMorphIndex = smileEntry?.[1] ?? -1
        host.dataset.morphNames = morphEntries.map(([name]) => name).slice(0, 60).join('|')
        host.dataset.mouthMorph = mouthMorphIndices.map(({ index }) => morphEntries.find(([, value]) => value === index)?.[0] ?? '').filter(Boolean).join('/')
        host.dataset.boneNames = bones.map((bone) => bone.name).slice(0, 120).join('|')
        let idleClip: import('three').AnimationClip | null = null
        let talkClip: import('three').AnimationClip | null = null
        const loadMotion = (url: string): Promise<import('three').AnimationClip> => new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('MMD 动作加载超时')), 10000)
          loader.loadAnimation(url, model!, (clip) => { window.clearTimeout(timeout); resolve(clip as import('three').AnimationClip) }, undefined, (error) => { window.clearTimeout(timeout); reject(error) })
        })
        if (info.idleMotionUrl) {
          try { idleClip = await loadMotion(info.idleMotionUrl) } catch (error) { console.warn('MMD idle motion could not be loaded:', error) }
        }
        if (info.talkMotionUrl) {
          try { talkClip = await loadMotion(info.talkMotionUrl) } catch (error) { console.warn('MMD talk motion could not be loaded:', error) }
        }
        if (disposed) return
        const usableIdleClip = idleClip?.tracks.length ? idleClip : null
        const usableTalkClip = talkClip?.tracks.length ? talkClip : null
        {
          const helper = new MMDAnimationHelper({ afterglow: 0 })
          // Render the character immediately. Ammo initialization and physics
          // warmup are optional enhancements and must never hold the call UI.
          helper.add(model, usableIdleClip ? { animation: usableIdleClip, physics: false } : { physics: false })
          motionHelper = helper
          const helperObjects = (helper as unknown as { objects: WeakMap<object, { mixer?: import('three').AnimationMixer }> }).objects
          const mixer = helperObjects.get(model)?.mixer
          if (mixer && usableIdleClip) {
            idleAction = mixer.clipAction(usableIdleClip)
            talkAction = usableTalkClip ? mixer.clipAction(usableTalkClip) : null
            if (talkAction) talkAction.setLoop(THREE.LoopRepeat, Infinity)
          } else if (usableIdleClip) {
            console.warn('MMD animation mixer was not created; using procedural idle motion.')
          }
        }
        if (usableIdleClip) host.dataset.idleMotion = `${usableIdleClip.tracks.length} tracks`
        if (usableTalkClip) host.dataset.talkMotion = `${usableTalkClip.tracks.length} tracks`
        fit()
        resizeObserver = new ResizeObserver(fit)
        resizeObserver.observe(host)
        onReady()

        const clockStart = performance.now()
        let previousFrameTime = clockStart
        let wasSpeaking = false
        const animate = (): void => {
          if (!renderer || disposed) return
          frame = window.requestAnimationFrame(animate)
          renderer.toneMappingExposure = renderRef.current.exposure
          const lighting = renderRef.current
          ambientLight.intensity = 1.35 * lighting.ambientLight * (1 - lighting.shadowStrength * 0.45)
          keyLight.intensity = 2.0 * lighting.light * lighting.keyLight
          fillLight.intensity = 0.8 * lighting.light * lighting.fillLight * (1 - lighting.shadowStrength * 0.35)
          rimLight.intensity = 1.45 * lighting.light * lighting.rimLight
          faceLight.intensity = 0.55 * lighting.light * lighting.faceLight
          keyLight.color.setHSL(0.1 - lighting.warmth * 0.08, 0.3 + Math.abs(lighting.warmth) * 0.2, 0.96)
          faceLight.color.setHSL(0.98 - lighting.warmth * 0.05, 0.35, 0.93)
          const now = performance.now()
          const elapsed = (now - clockStart) / 1000
          const delta = Math.min((now - previousFrameTime) / 1000, 0.1)
          previousFrameTime = now
          if (motionHelper) {
            const speakingNow = speakingRef.current
            if (speakingNow !== wasSpeaking && talkAction && idleAction) {
              const nextAction = speakingNow ? talkAction : idleAction
              const previousAction = speakingNow ? idleAction : talkAction
              nextAction.reset().play()
              previousAction.crossFadeTo(nextAction, 0.7, false)
            }
            wasSpeaking = speakingNow
            motionHelper.update(delta)
          }
          const progress = progressRef.current
          const rawSpeechLevel = speakingRef.current ? Math.max(0, Math.min(1, lipSyncAmplitude.current)) : 0
          smoothedSpeechLevel += (rawSpeechLevel - smoothedSpeechLevel) * (rawSpeechLevel > smoothedSpeechLevel ? 0.18 : 0.075)
          const voiceActive = speakingRef.current && smoothedSpeechLevel > 0.14
          const speechBeat = speakingRef.current && speechBoundary.current > lastSpeechBoundary
          if (speechBeat) lastSpeechBoundary = speechBoundary.current
          const voiceOnset = voiceActive && !voiceWasActive
          voiceWasActive = voiceActive
          if (speakingRef.current && now - lastSpeechGestureAt > 2600 && (speechBeat || voiceOnset)) {
            gestureSide = nextGestureSide
            nextGestureSide = nextGestureSide === 'left' ? 'right' : 'left'
            speechGestureStartedAt = now
            lastSpeechGestureAt = now
            gestureStrength = speechBeat && smoothedSpeechLevel < 0.08 ? 0.72 : Math.max(0.55, Math.min(0.9, 0.55 + smoothedSpeechLevel * 0.45))
          }
          const gestureTime = (now - speechGestureStartedAt) / 1450
          const gestureEnvelope = gestureTime >= 0 && gestureTime <= 1 ? Math.pow(Math.sin(Math.PI * gestureTime), 1.4) * gestureStrength : 0
          const gestureDirection = gestureSide === 'left' ? -1 : 1
          const leftGesture = gestureSide === 'left' ? gestureEnvelope : 0
          const rightGesture = gestureSide === 'right' ? gestureEnvelope : 0
          if (!idleAction && headBone) {
            const base = originalRotations.get(headBone)
            if (base) headBone.rotation.set(base.x + Math.sin(elapsed * 0.55) * 0.012 + gestureEnvelope * 0.018, base.y + Math.sin(elapsed * 0.36) * 0.02 + gestureEnvelope * gestureDirection * 0.018, base.z + Math.sin(elapsed * 0.3) * 0.01)
          }
          if (!idleAction && neckBone) {
            const base = originalRotations.get(neckBone)
            if (base) neckBone.rotation.set(base.x + gestureEnvelope * 0.008, base.y + gestureEnvelope * gestureDirection * 0.008, base.z)
          }
          if (!idleAction && torsoBone) {
            const base = originalRotations.get(torsoBone)
            if (base) torsoBone.rotation.set(base.x + Math.sin(elapsed * 1.3) * 0.006, base.y + Math.sin(elapsed * 0.2) * 0.012, base.z)
          }
          const applyBoneZ = (bone: import('three').Bone | undefined, amount: number): void => {
            const base = bone ? originalRotations.get(bone) : undefined
            if (bone && base) bone.rotation.z = base.z + amount
          }
          if (!idleAction) {
            applyBoneZ(leftShoulderBone, restPose.leftShoulder + leftGesture * gestureDirection * 0.025)
            applyBoneZ(rightShoulderBone, restPose.rightShoulder + rightGesture * gestureDirection * 0.025)
            applyBoneZ(leftArmBone, restPose.leftArm + leftGesture * gestureDirection * 0.11)
            applyBoneZ(rightArmBone, restPose.rightArm + rightGesture * gestureDirection * 0.11)
            applyBoneZ(leftElbowBone, restPose.leftElbow - leftGesture * 0.08)
            applyBoneZ(rightElbowBone, restPose.rightElbow + rightGesture * 0.08)
            applyBoneZ(leftWristBone, restPose.leftWrist + leftGesture * gestureDirection * 0.045)
            applyBoneZ(rightWristBone, restPose.rightWrist + rightGesture * gestureDirection * 0.045)
          }

          const influences = model?.morphTargetInfluences
          if (influences) {
            if (now >= nextBlink) {
              blinkStarted = now
              nextBlink = now + 3200 + Math.random() * 4200
            }
            if (blinkMorphIndex >= 0) {
              const blinkProgress = (now - blinkStarted) / 150
              influences[blinkMorphIndex] = blinkProgress >= 0 && blinkProgress <= 1 ? Math.sin(blinkProgress * Math.PI) : 0
            }
            if (smileMorphIndex >= 0) {
              const targetSmile = speakingRef.current ? 0.13 : 0.035
              influences[smileMorphIndex] += (targetSmile - influences[smileMorphIndex]) * 0.08
            }
            if (mouthMorphIndices.length > 0) {
              const audioLevel = smoothedSpeechLevel
              const boundaryAge = now - lastSpeechBoundary
              const boundaryPulse = boundaryAge >= 0 && boundaryAge < 220
                ? Math.sin((1 - boundaryAge / 220) * Math.PI * 0.5) * 0.48
                : 0
              const targetMouth = speakingRef.current ? Math.max(audioLevel, boundaryPulse) : 0
              const attack = targetMouth > mouthEnvelope ? 0.56 : 0.24
              mouthEnvelope += (targetMouth - mouthEnvelope) * attack
              const mouthOpen = Math.min(1, mouthEnvelope * 1.65)
              const vowelIndex = Math.floor(Math.max(0, progress) * 24) % mouthMorphIndices.length
              mouthMorphIndices.forEach(({ index, weight }, indexInList) => {
                const vowelStrength = indexInList === vowelIndex ? 1 : 0.025
                influences[index] = mouthOpen * weight * vowelStrength
              })
            }
          }
          renderer.render(scene, camera)
        }
        frame = window.requestAnimationFrame(animate)
        void ensureMmdPhysicsRuntime().then((physicsReady) => {
          if (!physicsReady || disposed || !model) return
          try {
            const physicsHelper = new MMDAnimationHelper({ afterglow: 0 })
            physicsWorld = createMmdWorld((window as Window & { Ammo?: unknown }).Ammo)
            const physicsConfig = { ...(usableIdleClip ? { animation: usableIdleClip } : {}), physics: true, warmup: 24, world: physicsWorld.world }
            physicsHelper.add(model, physicsConfig)
            physicsResources = (physicsHelper as unknown as { objects: WeakMap<object, { physics?: PhysicsResources }> }).objects.get(model)?.physics
            motionHelper?.remove(model)
            motionHelper = physicsHelper
            const helperObjects = (physicsHelper as unknown as { objects: WeakMap<object, { mixer?: import('three').AnimationMixer }> }).objects
            const mixer = helperObjects.get(model)?.mixer
            if (mixer && usableIdleClip) {
              idleAction = mixer.clipAction(usableIdleClip)
              talkAction = usableTalkClip ? mixer.clipAction(usableTalkClip) : null
              if (talkAction) talkAction.setLoop(THREE.LoopRepeat, Infinity)
              if (speakingRef.current && talkAction) {
                idleAction.play()
                talkAction.play()
                idleAction.crossFadeTo(talkAction, 0.45, false)
              }
            }
          } catch (error) {
            motionHelper?.enable('physics', false)
            physicsWorld?.dispose(physicsResources)
            physicsWorld = undefined
            physicsResources = undefined
            console.warn('MMD physics could not be attached; keeping the rendered model:', error)
          }
        })
      } catch (error) {
        if (!disposed) onError(error instanceof Error ? error.message : 'MMD 3D 模型加载失败')
      }
    })()
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      physicsWorld?.dispose(physicsResources)
      if (sceneModel) {
        idleAction?.stop()
        talkAction?.stop()
        motionHelper?.remove(sceneModel)
        disposeModel(sceneModel)
        sceneModel = null
      }
      motionHelper = null
      renderer?.dispose()
      renderer?.forceContextLoss()
      const canvas = hostRef.current?.querySelector('canvas')
      canvas?.remove()
    }
  }, [info.modelUrl, info.idleMotionUrl, info.talkMotionUrl, onError, onReady, lipSyncAmplitude, speechBoundary])

  return <div ref={hostRef} className="live-call-model-stage" aria-label={`${info.modelName} MMD 3D 模型`} />
}

export default function CallWindow(): React.ReactElement {
  const callMode = new URLSearchParams(window.location.search).get('mode') === 'voice' ? 'voice' : 'video'
  const { ready, character, setAutoSpeak, setSyncRatio, pushToast, settings, saveSettings, saveCharacter } = useApp()
  const { speak, playAudioUrl, stop, mode, speaking, onProgress, onAmplitude, onBoundary, lastError } = useSpeech(true)
  const [recording, setRecording] = useState(false)
  const [micPreparing, setMicPreparing] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [interim, setInterim] = useState('')
  const [recognizedText, setRecognizedText] = useState('')
  const [recordingAction, setRecordingAction] = useState<'send' | 'draft' | 'cancel'>('send')
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyPending, setReplyPending] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [callConversationId, setCallConversationId] = useState('')
  const [incomingRinging, setIncomingRinging] = useState(false)
  const [callStateReady, setCallStateReady] = useState(false)
  const [pendingGreeting, setPendingGreeting] = useState<{ text: string; opusUrl: string | null } | null>(null)
  const [callInitiator, setCallInitiator] = useState<'user' | 'character'>('user')
  const [live2dPreparing, setLive2dPreparing] = useState(true)
  const [live2dInfo, setLive2dInfo] = useState<Live2DInfo | null>(null)
  const [live2dLoadKey, setLive2dLoadKey] = useState(0)
  const [live2dError, setLive2dError] = useState('')
  const [live2dLoaded, setLive2dLoaded] = useState(false)
  const [lipSyncProgress, setLipSyncProgress] = useState(0)
  const lipSyncAmplitude = useRef(0)
  const speechBoundary = useRef(0)
  const recordingHeldRef = useRef(false)
  const recordingActionRef = useRef<'send' | 'draft' | 'cancel'>('send')
  const draftTargetRef = useRef<HTMLDivElement>(null)
  const cancelTargetRef = useRef<HTMLDivElement>(null)
  const recordingGenerationRef = useRef(0)
  const lastPreviewSamplesRef = useRef(0)
  const liveRecognitionTimerRef = useRef<number | null>(null)
  const liveRecognitionPromiseRef = useRef<Promise<void> | null>(null)
  const recordingSamplesRef = useRef<Float32Array[]>([])
  const recordedSamplesCountRef = useRef(0)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const silentOutputRef = useRef<GainNode | null>(null)
  const transcribingRef = useRef(false)
  const replyTimerRef = useRef<number | null>(null)
  const modelPrepareGenerationRef = useRef(0)

  useEffect(() => {
    const off = window.aimis.chat.onStream((chunk) => {
      if (!callConversationId || chunk.conversationId !== callConversationId) return
      if (chunk.type === 'done' || chunk.type === 'error' || chunk.type === 'cancelled') {
        if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
        replyTimerRef.current = null
        setReplyPending(false)
        if (chunk.type === 'error') setVoiceError(chunk.error || '角色回复失败，请重试。')
      }
    })
    return () => {
      off()
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
    }
  }, [callConversationId])

  useEffect(() => {
    if (!incomingRinging || !settings?.voiceCall?.ringtoneEnabled || (settings.voiceCall.ringtoneVolume ?? 0) <= 0) return
    if (settings.voiceCall.ringtonePath) {
      const audio = new Audio(toLocalUrl(settings.voiceCall.ringtonePath))
      audio.loop = true
      audio.volume = Math.max(0, Math.min(1, settings.voiceCall.ringtoneVolume / 100))
      void selectAudioOutput(settings.voiceCall.outputDeviceId, audio)
        .then(() => audio.play())
        .catch((error) => console.warn('[call] 自定义铃声播放失败：', error))
      return () => {
        audio.pause()
        audio.currentTime = 0
      }
    }
    const AudioContextCtor = window.AudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    let disposed = false
    const volume = Math.max(0, Math.min(1, settings.voiceCall.ringtoneVolume / 100)) * 0.14
    const playTone = (frequencies: number[], delay: number, duration: number): void => {
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const start = context.currentTime + delay
        oscillator.type = settings.voiceCall.ringtoneStyle === 'soft' ? 'sine' : 'triangle'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(volume / frequencies.length, start + 0.035)
        gain.gain.setValueAtTime(volume / frequencies.length, start + duration - 0.06)
        gain.gain.linearRampToValueAtTime(0, start + duration)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + duration)
      }
    }
    const ring = (): void => {
      if (settings.voiceCall.ringtoneStyle === 'soft') playTone([660], 0, 0.55)
      else {
        playTone([440, 480], 0, 0.42)
        playTone([440, 480], 0.58, 0.42)
      }
    }
    let timer: number | null = null
    void selectAudioOutput(settings.voiceCall.outputDeviceId, null, context)
      .then(() => context.resume())
      .then(() => {
        if (disposed) return
        ring()
        timer = window.setInterval(ring, 1900)
      }).catch((error) => {
        if (!disposed) setVoiceError(`输出设备不可用：${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      disposed = true
      if (timer !== null) window.clearInterval(timer)
      void context.close().catch(() => undefined)
    }
  }, [incomingRinging, settings?.voiceCall?.ringtoneEnabled, settings?.voiceCall?.ringtoneStyle, settings?.voiceCall?.ringtoneVolume, settings?.voiceCall?.ringtonePath, settings?.voiceCall?.outputDeviceId])

  const refreshLive2d = useCallback(async (): Promise<void> => {
    const generation = ++modelPrepareGenerationRef.current
    setLive2dPreparing(true)
    try {
      const result = await withTimeout(window.aimis.live2d.prepare(character?.id), 30000, '模型配置读取超时')
      if (generation !== modelPrepareGenerationRef.current) return
      if (!result.ok || !result.data) throw new Error(result.error ?? '模型配置读取失败')
      setLive2dLoaded(false)
      setLive2dLoadKey((key) => key + 1)
      setLive2dInfo(result.data)
      setLive2dError(result.data.missingCore ? '缺少 Cubism Core 运行时' : '')
    } catch (error) {
      if (generation !== modelPrepareGenerationRef.current) return
      setLive2dInfo(null)
      setLive2dError(error instanceof Error ? error.message : '模型配置读取失败')
    } finally {
      if (generation === modelPrepareGenerationRef.current) setLive2dPreparing(false)
    }
  }, [character?.id, character?.callModelPath, settings?.live2d.modelPath])

  useEffect(() => {
    if (callMode === 'video') void refreshLive2d()
    else { setLive2dPreparing(false); setLive2dInfo(null); setLive2dLoaded(false) }
    return () => { modelPrepareGenerationRef.current++ }
  }, [refreshLive2d, callMode])

  useEffect(() => {
    let cancelled = false
    void withTimeout(window.aimis.call.state(), 4000, '通话状态读取超时').then((result) => {
      if (!result.ok || !result.data || cancelled) return
      setCallInitiator(result.data.initiator)
      setIncomingRinging(result.data.phase === 'ringing')
    }).catch((error: unknown) => {
      if (!cancelled) setVoiceError(error instanceof Error ? `通话状态读取失败：${error.message}` : '通话状态读取失败')
    }).finally(() => {
      // A state IPC failure must not leave the model behind an endless
      // connection overlay. Model loading has its own independent lifecycle.
      if (!cancelled) setCallStateReady(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready || !character) return
    let cancelled = false
    void window.aimis.call.begin().then((result) => {
      if (!result.ok || !result.data) throw new Error(result.error ?? '通话会话创建失败')
      if (cancelled) return
      setCallConversationId(result.data.conversationId)
      const greeting = result.data.greeting
      if (greeting) setPendingGreeting(greeting)
    }).catch((error) => {
      if (!cancelled) setVoiceError(error instanceof Error ? error.message : '通话会话创建失败')
    })
    return () => { cancelled = true }
  }, [ready, character?.id])

  useEffect(() => {
    onAmplitude((level) => { lipSyncAmplitude.current = level })
    return () => onAmplitude(null)
  }, [onAmplitude])

  useEffect(() => {
    onBoundary(() => { speechBoundary.current = performance.now() })
    return () => onBoundary(null)
  }, [onBoundary])

  const pickLive2dModel = async (): Promise<void> => {
    const result = await window.aimis.live2d.pickModel(character?.callModelPath || settings?.live2d.modelPath || undefined)
    if (!result.ok) { setLive2dError(result.error ?? '选择模型失败'); return }
    if (result.data) {
      if (character) await saveCharacter({ id: character.id, callModelPath: result.data })
      await refreshLive2d()
    }
  }

  const pickLive2dCore = async (): Promise<void> => {
    const result = await window.aimis.live2d.pickCore()
    if (!result.ok) { setLive2dError(result.error ?? '选择 Cubism Core 失败'); return }
    if (result.data) {
      await saveSettings({ live2d: { ...(settings?.live2d ?? { modelPath: '', corePath: '' }), corePath: result.data } })
      await refreshLive2d()
    }
  }

  const reportLive2dError = useCallback((message: string): void => {
    setLive2dLoaded(false)
    setLive2dError(message)
    pushToast({ ok: false, text: `Live2D 加载失败：${message}` })
  }, [pushToast])
  const markLive2dLoaded = useCallback((): void => {
    setLive2dLoaded(true)
    setLive2dError('')
  }, [])

  const sendVoiceText = useCallback(async (text: string): Promise<void> => {
    const phrase = text.trim()
    if (!phrase) return
    setSubmitting(true)
    setInterim('')
    setVoiceError('')
    setReplyPending(true)
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
    replyTimerRef.current = window.setTimeout(() => {
      void window.aimis.chat.abort(callConversationId)
      setReplyPending(false)
      setVoiceError('等待角色回复超时。你可以继续输入，或检查模型连接后重试。')
    }, 75000)
    try {
        if (!callConversationId) throw new Error('通话正在准备，请稍后再试')
        const result = await window.aimis.call.send({ conversationId: callConversationId, text: phrase })
        if (!result.ok) throw new Error(result.error ?? '发送语音消息失败')
    } catch (error) {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
      replyTimerRef.current = null
      setReplyPending(false)
      pushToast({ ok: false, text: error instanceof Error ? error.message : '发送语音消息失败' })
    } finally {
      setSubmitting(false)
    }
  }, [callConversationId, pushToast])

  const releaseMicrophone = useCallback((): { audio: Float32Array; sampleRate: number } => {
    const audio = new Float32Array(recordedSamplesCountRef.current)
    let offset = 0
    for (const chunk of recordingSamplesRef.current) { audio.set(chunk, offset); offset += chunk.length }
    const sampleRate = audioContextRef.current?.sampleRate ?? 16000
    recordingSamplesRef.current = []
    recordedSamplesCountRef.current = 0
    if (processorRef.current) processorRef.current.onaudioprocess = null
    processorRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    silentOutputRef.current?.disconnect()
    silentOutputRef.current = null
    void audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    setRecording(false)
    return { audio, sampleRate }
  }, [])

  useEffect(() => () => {
    recordingHeldRef.current = false
    recordingGenerationRef.current += 1
    cancelLocalSpeechRecognition()
    if (liveRecognitionTimerRef.current !== null) window.clearInterval(liveRecognitionTimerRef.current)
    releaseMicrophone()
  }, [releaseMicrophone])

  const updateRecordingAction = (action: 'send' | 'draft' | 'cancel'): void => {
    if (recordingActionRef.current === action) return
    recordingActionRef.current = action
    setRecordingAction(action)
  }

  const recordingActionAt = (x: number, y: number): 'send' | 'draft' | 'cancel' => {
    const inside = (element: HTMLDivElement | null): boolean => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
    if (inside(draftTargetRef.current)) return 'draft'
    if (inside(cancelTargetRef.current)) return 'cancel'
    return 'send'
  }

  const recognizeWhileHolding = (): void => {
    if (!recordingHeldRef.current || liveRecognitionPromiseRef.current) return
    const sampleRate = audioContextRef.current?.sampleRate ?? 16000
    if (recordedSamplesCountRef.current < sampleRate * 3) return
    if (recordedSamplesCountRef.current - lastPreviewSamplesRef.current < sampleRate * 5) return
    const generation = recordingGenerationRef.current
    const start = Math.max(0, recordedSamplesCountRef.current - sampleRate * 12)
    const audio = new Float32Array(recordedSamplesCountRef.current - start)
    let sourceOffset = 0
    for (const chunk of recordingSamplesRef.current) {
      const end = sourceOffset + chunk.length
      if (end > start) audio.set(chunk.subarray(Math.max(0, start - sourceOffset)), Math.max(0, sourceOffset - start))
      sourceOffset = end
    }
    lastPreviewSamplesRef.current = recordedSamplesCountRef.current
    const promise = transcribeLocalSpeech(audio, sampleRate, settings?.voice.sttLanguage || 'zh', (message) => {
      if (recordingHeldRef.current && generation === recordingGenerationRef.current) setInterim(message)
    }).then((text) => {
      if (recordingHeldRef.current && generation === recordingGenerationRef.current) {
        if (text.trim()) setRecognizedText(text.trim())
        setInterim('')
      }
    }).catch((error: unknown) => {
      if (recordingHeldRef.current && generation === recordingGenerationRef.current) {
        setInterim(`实时识别暂不可用：${error instanceof Error ? error.message : String(error)}`)
      }
    }).finally(() => { if (liveRecognitionPromiseRef.current === promise) liveRecognitionPromiseRef.current = null })
    liveRecognitionPromiseRef.current = promise
  }

  const beginRecording = async (event: React.PointerEvent<HTMLButtonElement> | null): Promise<void> => {
    if (recordingHeldRef.current || transcribingRef.current || isEnding || incomingRinging) return
    if (event) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    recordingHeldRef.current = true
    recordingGenerationRef.current += 1
    const generation = recordingGenerationRef.current
    lastPreviewSamplesRef.current = 0
    updateRecordingAction('send')
    setVoiceError('')
    setInterim('')
    setRecognizedText('')
    setMicPreparing(true)
    if (speaking) stop()
    if (replyPending) {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current)
      replyTimerRef.current = null
      setReplyPending(false)
      void window.aimis.chat.abort(callConversationId)
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前运行环境无法访问麦克风')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings?.voiceCall.inputDeviceId ? { exact: settings.voiceCall.inputDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      if (!recordingHeldRef.current || generation !== recordingGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      micStreamRef.current = stream
      const context = new AudioContext()
      audioContextRef.current = context
      await context.resume()
      if (generation !== recordingGenerationRef.current) {
        void context.close().catch(() => undefined)
        stream.getTracks().forEach(track => track.stop())
        return
      }
      if (!recordingHeldRef.current) {
        releaseMicrophone()
        return
      }
      recordingSamplesRef.current = []
      recordedSamplesCountRef.current = 0
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const silentOutput = context.createGain()
      silentOutput.gain.value = 0
      sourceRef.current = source
      processorRef.current = processor
      silentOutputRef.current = silentOutput
      processor.onaudioprocess = (audioEvent) => {
        if (!recordingHeldRef.current) return
        const data = audioEvent.inputBuffer.getChannelData(0)
        recordingSamplesRef.current.push(data.slice())
        recordedSamplesCountRef.current += data.length
      }
      source.connect(processor)
      processor.connect(silentOutput)
      silentOutput.connect(context.destination)
      setRecording(true)
      liveRecognitionTimerRef.current = window.setInterval(recognizeWhileHolding, 3000)
    } catch (error) {
      if (generation !== recordingGenerationRef.current) return
      recordingHeldRef.current = false
      releaseMicrophone()
      const message = error instanceof Error ? error.message : String(error)
      setVoiceError(/notallowed|permission|denied/i.test(message)
        ? '麦克风权限被拒绝，请在 Windows 设置中允许桌面应用访问麦克风。'
        : /notfound|device|麦克风/i.test(message)
          ? '所选麦克风不可用，请到「设置 → 语音通话」重新选择。'
          : `无法开始录音：${message}`)
    } finally {
      if (generation === recordingGenerationRef.current) setMicPreparing(false)
    }
  }

  const finishRecording = async (action: 'send' | 'draft' | 'cancel' = recordingActionRef.current): Promise<void> => {
    if (!recordingHeldRef.current) return
    recordingHeldRef.current = false
    recordingGenerationRef.current += 1
    setMicPreparing(false)
    if (liveRecognitionTimerRef.current !== null) window.clearInterval(liveRecognitionTimerRef.current)
    liveRecognitionTimerRef.current = null
    const { audio, sampleRate } = releaseMicrophone()
    updateRecordingAction('send')
    if (action === 'cancel') { cancelLocalSpeechRecognition(); setInterim(''); setRecognizedText(''); return }
    if (audio.length < sampleRate * 0.2) return
    transcribingRef.current = true
    const generation = recordingGenerationRef.current
    setInterim('正在本地识别…')
    try {
      if (liveRecognitionPromiseRef.current) await liveRecognitionPromiseRef.current
      const text = await transcribeLocalSpeech(audio, sampleRate, settings?.voice.sttLanguage || 'zh', setInterim)
      if (generation !== recordingGenerationRef.current) return
      setInterim('')
      setRecognizedText('')
      if (text.trim() && action === 'draft') setInput((previous) => previous.trim() ? `${previous.trim()} ${text.trim()}` : text.trim())
      else if (text.trim()) await sendVoiceText(text)
      else setVoiceError('没有识别到语音，请按住麦克风再说一次。')
    } catch (error) {
      if (generation !== recordingGenerationRef.current || (error as Error).name === 'AbortError') return
      setInterim('')
      setRecognizedText('')
      const detail = error instanceof Error ? error.message : String(error)
      setVoiceError(/file was not found locally/i.test(detail)
        ? '安装包缺少本地识别模型文件，请重新安装最新版。'
        : `本地语音识别失败：${detail}`)
    } finally {
      transcribingRef.current = false
    }
  }
  useEffect(() => {
    setAutoSpeak((text) => mode === 'off' ? Promise.resolve(false) : speak(text))
    onProgress((progress) => { setLipSyncProgress(progress); setSyncRatio(progress) })
    return () => {
      setAutoSpeak(null)
      onProgress(null)
      stop()
    }
  }, [mode, onProgress, setAutoSpeak, setSyncRatio, speak, stop])

  const submitTyped = async (): Promise<void> => {
    const text = input.trim()
    if (!text || replyPending || submitting) return
    setInput('')
    await sendVoiceText(text)
  }

  const answerIncomingCall = async (): Promise<void> => {
    const result = await window.aimis.call.accept()
    if (!result.ok) { setVoiceError(result.error ?? '接听失败'); return }
    setIncomingRinging(false)
    if (result.data?.greeting) setPendingGreeting(result.data.greeting)
  }

  const rejectIncomingCall = async (): Promise<void> => {
    const result = await window.aimis.call.reject()
    if (!result.ok) setVoiceError(result.error ?? '挂断失败')
    else setIncomingRinging(false)
  }

  const hangUpCall = (): void => {
    if (isEnding) return
    setIsEnding(true)
    recordingGenerationRef.current += 1
    cancelLocalSpeechRecognition()
    void window.aimis.chat.abort(callConversationId)
    recordingHeldRef.current = false
    releaseMicrophone()
    setInterim('')
    stop()
    window.setTimeout(() => {
      if (incomingRinging) void rejectIncomingCall()
      else window.aimis.call.close()
    }, 680)
  }

  const status = recording ? '正在录音' : replyPending || submitting
    ? '正在回应'
    : speaking
        ? '正在说话'
        : incomingRinging ? '等待接听' : '通话已接通'
  const avatar = toLocalUrl(character?.avatar.main)
  const renderKey = callRenderKey(character?.id || '', character?.callModelPath, settings?.live2d.modelPath)
  const renderConfig = { ...defaultCallRender(character?.id || ''), ...settings?.voiceCall.renderByModel?.[renderKey] }
  const modelInfo = live2dInfo && !live2dInfo.missingCore && !live2dError ? live2dInfo : null
  const modelLoading = !callStateReady || (callMode === 'video' && (live2dPreparing || (Boolean(modelInfo) && !live2dLoaded)))
  const showLoadedModel = callStateReady && !incomingRinging && live2dLoaded
  const showCharacterScene = callStateReady && !incomingRinging

  useEffect(() => {
    if (!pendingGreeting || !callStateReady || incomingRinging || modelLoading) return
    let cancelled = false
    const greeting = pendingGreeting
    void (async () => {
      const played = greeting.opusUrl ? await playAudioUrl(greeting.opusUrl) : false
      if (!played) await speak(greeting.text)
      if (cancelled) return
      setPendingGreeting(null)
    })()
    return () => { cancelled = true }
  }, [pendingGreeting, callStateReady, incomingRinging, modelLoading, playAudioUrl, speak])

  return (
    <main className={`live-call-window${isEnding ? ' is-ending' : ''}${callMode === 'voice' ? ' is-voice' : ''}`}>
      <div className="live-call-scene">
        {callMode === 'video' && showCharacterScene && <CallBackground config={settings?.voiceCall} characterId={character?.id} fallback={character?.avatar.banner} />}
        <div className="live-call-topbar">
          <div className={`live-call-contact${incomingRinging ? ' is-ringing' : ''}`}>
            <strong>{character?.name ?? '角色'}</strong>
            {!incomingRinging && <span>{callMode === 'voice' ? `语音通话 · ${status}` : `视频通话 · ${status}`}</span>}
          </div>
        </div>
        {incomingRinging && <div className="live-call-incoming-title">{character?.name ?? '角色'}来电</div>}
        {callMode === 'video' && modelInfo
          ? <div className={`live-call-model-shell${showLoadedModel ? ' is-loaded' : ' is-loading'}`} style={callRenderStyle(renderConfig)}>
              {modelInfo.format === 'mmd-pmx'
                ? <MmdStage key={live2dLoadKey} info={modelInfo} speaking={speaking} lipSyncProgress={lipSyncProgress} lipSyncAmplitude={lipSyncAmplitude} speechBoundary={speechBoundary} onReady={markLive2dLoaded} onError={reportLive2dError} renderConfig={renderConfig} />
                : modelInfo.format === 'gltf'
                  ? <ShorekeeperStage key={live2dLoadKey} info={modelInfo} speaking={speaking} lipSyncProgress={lipSyncProgress} lipSyncAmplitude={lipSyncAmplitude} onReady={markLive2dLoaded} onError={reportLive2dError} renderConfig={renderConfig} />
                : <Live2DStage key={live2dLoadKey} info={modelInfo} speaking={speaking} lipSyncProgress={lipSyncProgress} lipSyncAmplitude={lipSyncAmplitude} onReady={markLive2dLoaded} onError={reportLive2dError} />}
            </div>
          : callStateReady && (!incomingRinging || callMode === 'voice') ? <div className={`live-call-avatar${replyPending || speaking ? ' is-speaking' : ''}`}>
              {avatar ? <img src={avatar} alt={character?.name ?? '角色'} /> : <span>{character?.name?.slice(0, 1) ?? '◇'}</span>}
              <div className="live-call-avatar-glow" />
              {callMode === 'voice' && <div className="live-call-voice-bars" aria-hidden="true"><i /><i /><i /><i /><i /></div>}
            </div> : null}
        {modelLoading && !incomingRinging && <div className="live-call-loading-overlay" role="status"><span>{callInitiator === 'user' ? `等待${character?.name ?? '角色'}接听中…` : `正在连接${character?.name ?? '角色'}…`}</span></div>}
      </div>
      <div className="live-call-controls">
        {(voiceError || lastError) && <div className="live-call-error">{voiceError || lastError}</div>}
        {incomingRinging ? <div className="live-call-incoming-actions">
            <span>{character?.name ?? '角色'}正在呼叫你</span>
            <button className="live-call-answer" onClick={() => void answerIncomingCall()}><Phone size={17} /> 接听</button>
            <button className="live-call-reject" onClick={hangUpCall} disabled={isEnding}><PhoneOff size={17} /> 挂断</button>
          </div> : <>
          {callMode === 'video' && <div className="live-call-model-config">
            <button onClick={() => void pickLive2dModel()} aria-label={live2dInfo?.modelName || undefined}>模型</button>
            {live2dInfo?.format === 'cubism' && <button onClick={() => void pickLive2dCore()} aria-label="选择 Cubism Core 运行时">Core</button>}
          </div>}
          {callMode === 'video' && live2dError && <div className="live-call-model-note" title={live2dError}>模型加载失败，已显示角色头像</div>}
          {!recording && !micPreparing && (interim || recognizedText) && <div className="live-call-transcript" role="status">
            <span>语音识别</span>
            <strong>{recognizedText || interim}</strong>
          </div>}
          <div className="live-call-input-row">
            <input
              aria-label="输入消息"
              placeholder={interim || '也可以输入文字…'}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void submitTyped() }}
              disabled={!ready}
            />
            <button className="live-call-send" onClick={() => void submitTyped()} disabled={!input.trim() || replyPending || submitting} aria-label="发送文字">↑</button>
          </div>
          <div className="live-call-actions">
            <button className={`live-call-mic${recording ? ' active' : ''}${recordingAction === 'cancel' && recording ? ' cancel' : ''}`}
              onPointerDown={(event) => void beginRecording(event)}
              onPointerMove={(event) => {
                if (!recordingHeldRef.current) return
                updateRecordingAction(recordingActionAt(event.clientX, event.clientY))
              }}
              onPointerUp={(event) => void finishRecording(recordingActionAt(event.clientX, event.clientY))}
              onPointerCancel={() => void finishRecording('cancel')}
              onLostPointerCapture={() => { if (recordingHeldRef.current) void finishRecording('cancel') }}
              onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); void beginRecording(null) } }}
              onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void finishRecording('send') } }}
              onContextMenu={(event) => event.preventDefault()}
              style={{ touchAction: 'none' }}
              aria-label="按住说话；左滑转文字，右滑取消，松开发送">
              <Mic size={19} strokeWidth={2.2} />
            </button>
            <button className="live-call-hangup" onClick={hangUpCall} disabled={isEnding} aria-label="挂断电话"><PhoneOff size={18} strokeWidth={2.2} /><span>挂断</span></button>
          </div>
        </>}
      </div>
      {(recording || micPreparing) && <div className="live-call-recording-overlay" aria-live="polite">
        <div className="live-call-recording-bubble">
          <div className="live-call-recording-wave" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <strong>{recognizedText || interim || (micPreparing ? '正在打开麦克风…' : '正在聆听…')}</strong>
        </div>
        <div className="live-call-recording-choices">
          <div ref={draftTargetRef} className={`live-call-recording-choice${recordingAction === 'draft' ? ' selected' : ''}`}>← 转文字</div>
          <div ref={cancelTargetRef} className={`live-call-recording-choice cancel${recordingAction === 'cancel' ? ' selected' : ''}`}>取消 →</div>
        </div>
        <div className="live-call-recording-release">{recordingAction === 'draft' ? '松手转文字' : recordingAction === 'cancel' ? '松手取消' : '松手发送'}</div>
      </div>}
      {isEnding && <div className="live-call-ending-overlay" role="status"><div className="live-call-ending-card"><span><PhoneOff size={22} /></span><strong>通话已结束</strong></div></div>}
    </main>
  )
}
