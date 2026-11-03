import { env, pipeline, type AutomaticSpeechRecognitionPipelineType } from '@huggingface/transformers'

const MODEL = 'onnx-community/whisper-tiny'
const MODEL_PREFIX = '/bundled-models/onnx-community/whisper-tiny/'
let recognizerPromise: Promise<AutomaticSpeechRecognitionPipelineType> | null = null
let requestId = 0
const requests = new Map<number, (value: { data?: Uint8Array | null; url?: string; error?: string }) => void>()

function request(type: 'model-file' | 'runtime-url', path?: string): Promise<{ data?: Uint8Array | null; url?: string; error?: string }> {
  const id = ++requestId
  const task = new Promise<{ data?: Uint8Array | null; url?: string; error?: string }>((resolve) => requests.set(id, resolve))
  self.postMessage({ type, id, path })
  return task
}

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/bundled-models/'
env.useBrowserCache = false
env.useCustomCache = true
env.customCache = {
  async match(name: string): Promise<Response | undefined> {
    if (!name.startsWith(MODEL_PREFIX)) return undefined
    const result = await request('model-file', name.slice(MODEL_PREFIX.length))
    if (result.error) throw new Error(result.error)
    if (!result.data) return undefined
    const body = new Uint8Array(result.data).buffer
    return new Response(body, { headers: { 'Content-Length': String(result.data.byteLength) } })
  },
  async put(): Promise<void> {}
}
const onnxEnv = env.backends.onnx as { wasm?: { numThreads?: number; wasmPaths?: string } }
onnxEnv.wasm ??= {}
onnxEnv.wasm.numThreads = 1

function progress(id: number, message: string): void { self.postMessage({ type: 'progress', id, message }) }

function recognizer(id: number): Promise<AutomaticSpeechRecognitionPipelineType> {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const runtime = await request('runtime-url')
      if (runtime.error || !runtime.url) throw new Error(runtime.error || '本地识别引擎文件不可用')
      onnxEnv.wasm!.wasmPaths = runtime.url
      return pipeline('automatic-speech-recognition', MODEL, {
        device: 'wasm', dtype: 'q8', local_files_only: true,
        progress_callback: (item) => {
          if (item.status === 'progress' && item.total > 0) progress(id, `正在加载本地识别模型 ${Math.min(99, Math.round(item.loaded / item.total * 100))}%…`)
        }
      })
    })().catch((error: unknown) => { recognizerPromise = null; throw error })
  }
  return recognizerPromise
}

function resample(audio: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000) return audio
  const output = new Float32Array(Math.max(1, Math.round(audio.length * 16000 / sourceRate)))
  const ratio = sourceRate / 16000
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio
    const left = Math.floor(position)
    const fraction = position - left
    output[index] = (audio[Math.min(left, audio.length - 1)] || 0) * (1 - fraction) + (audio[Math.min(left + 1, audio.length - 1)] || 0) * fraction
  }
  return output
}

let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<{ type: string; id: number; audio?: Float32Array; sampleRate?: number; language?: string; data?: Uint8Array | null; url?: string; error?: string }>) => {
  const message = event.data
  if (message.type === 'model-file-result' || message.type === 'runtime-url-result') {
    requests.get(message.id)?.(message)
    requests.delete(message.id)
    return
  }
  if (message.type !== 'transcribe' || !message.audio || !message.sampleRate) return
  queue = queue.then(async () => {
    try {
      const model = await recognizer(message.id)
      progress(message.id, '正在识别…')
      const language = message.language === 'zh' ? 'chinese' : message.language === 'en' ? 'english' : message.language || 'chinese'
      const result = await model(resample(message.audio!, message.sampleRate!), { language, task: 'transcribe', chunk_length_s: 25, stride_length_s: 5 })
      const text = Array.isArray(result) ? result.map((part) => part.text).join(' ').trim() : result.text.trim()
      self.postMessage({ type: 'result', id: message.id, text })
    } catch (error) {
      self.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) })
    }
  })
}
