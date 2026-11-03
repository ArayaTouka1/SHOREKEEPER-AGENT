type Reply = { type: string; id: number; text?: string; message?: string; path?: string; data?: Uint8Array | null; url?: string; error?: string }

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; progress: (message: string) => void; cleanup: () => void }>()

export function cancelLocalSpeechRecognition(reason: Error = new DOMException('识别已取消', 'AbortError')): void {
  if (!pending.size) return
  worker?.terminate()
  worker = null
  for (const request of pending.values()) { request.cleanup(); request.reject(reason) }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const next = new Worker(new URL('./localSpeechRecognition.worker.ts', import.meta.url), { type: 'module' })
  next.onerror = (event) => {
    if (worker === next) cancelLocalSpeechRecognition(new Error(event.message || '本地识别线程已停止'))
  }
  next.onmessage = async (event: MessageEvent<Reply>) => {
    const message = event.data
    if (message.type === 'model-file') {
      try {
        const result = await window.aimis.call.modelFile(message.path || '')
        if (worker !== next) return
        const data = result.ok ? result.data ?? null : null
        next.postMessage({ type: 'model-file-result', id: message.id, data, error: result.ok ? undefined : result.error }, data ? [data.buffer] : [])
      } catch (error) {
        next.postMessage({ type: 'model-file-result', id: message.id, data: null, error: String(error) })
      }
      return
    }
    if (message.type === 'runtime-url') {
      try {
        const result = await window.aimis.call.runtimeUrl()
        if (worker !== next) return
        next.postMessage({ type: 'runtime-url-result', id: message.id, url: result.ok ? result.data : undefined, error: result.ok ? undefined : result.error })
      } catch (error) {
        next.postMessage({ type: 'runtime-url-result', id: message.id, error: String(error) })
      }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    if (message.type === 'progress') request.progress(message.message || '')
    else if (message.type === 'result') { pending.delete(message.id); request.cleanup(); request.resolve(message.text || '') }
    else if (message.type === 'error') { pending.delete(message.id); request.cleanup(); request.reject(new Error(message.message || '本地识别失败')) }
  }
  worker = next
  return next
}

/** Gate steady room noise and trim silence before speech recognition. */
function voicedSegment(audio: Float32Array, sampleRate: number): Float32Array | null {
  const frameLength = Math.max(1, Math.round(sampleRate * .02))
  const levels: number[] = []
  for (let offset = 0; offset + frameLength <= audio.length; offset += frameLength) {
    let energy = 0
    for (let index = offset; index < offset + frameLength; index++) energy += audio[index] * audio[index]
    levels.push(Math.sqrt(energy / frameLength))
  }
  if (levels.length < 12) return null
  const sorted = [...levels].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * .2)]
  const threshold = Math.max(.008, floor * 2.2)
  let first = -1
  let last = -1
  let voiced = 0
  let streak = 0
  let longest = 0
  for (let index = 0; index < levels.length; index++) {
    if (levels[index] > threshold) {
      if (first < 0) first = index
      last = index
      voiced++
      streak++
      longest = Math.max(longest, streak)
    } else streak = 0
  }
  if (first < 0 || voiced < 13 || longest < 7 || voiced / levels.length < .035) return null
  const pad = Math.round(.18 * sampleRate)
  return audio.slice(Math.max(0, first * frameLength - pad), Math.min(audio.length, (last + 1) * frameLength + pad))
}

export async function transcribeLocalSpeech(audio: Float32Array, sampleRate: number, language: string, onProgress: (message: string) => void, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const segment = voicedSegment(audio, sampleRate)
  if (!segment) return ''
  const id = ++sequence
  const task = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => cancelLocalSpeechRecognition(new Error('本地识别超时，请重试；若持续超时，请缩短录音')), 90000)
    const abort = (): void => cancelLocalSpeechRecognition()
    const cleanup = (): void => { window.clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    pending.set(id, { resolve, reject, progress: onProgress, cleanup })
    signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    getWorker().postMessage({ type: 'transcribe', id, audio: segment, sampleRate, language }, [segment.buffer])
  } catch (error) {
    pending.get(id)?.cleanup()
    pending.delete(id)
    throw error
  }
  return task
}
