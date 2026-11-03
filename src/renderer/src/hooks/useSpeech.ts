import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { CharacterVoice } from '../../../shared/types'
import { selectAudioOutput } from '../utils/audioOutput'

/**
 *
 *
 */

export interface SpeechApi {
  speak: (text: string) => Promise<boolean>
  playAudioUrl: (url: string) => Promise<boolean>
  stop: () => void
  supported: boolean
  mode: 'inworld' | 'indextts' | 'gpt-sovits' | 'openai-local' | 'http-local' | 'synth' | 'off'
  lastError: string | null
  onProgress: (fn: ((p: number) => void) | null) => void
  onAmplitude: (fn: ((level: number) => void) | null) => void
  onBoundary: (fn: (() => void) | null) => void
  speaking: boolean
}

function keywordsOf(voiceId: string): string[] {
  if (!voiceId || voiceId === 'default') return []
  return voiceId
    .replace(/^zh-CN-/i, '')
    .replace(/Neural$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s-_]+/)
    .filter((w) => w.length > 2)
}

function pickVoice(voices: SpeechSynthesisVoice[], voiceId: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  const zh = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))
  const pool = zh.length ? zh : voices

  const keys = keywordsOf(voiceId)
  if (keys.length) {
    let best: { v: SpeechSynthesisVoice; score: number } | null = null
    for (const v of pool) {
      const name = (v.name + ' ' + v.voiceURI).toLowerCase()
      let score = 0
      for (const k of keys) if (name.includes(k)) score++
      if (score > 0 && (!best || score > best.score)) best = { v, score }
    }
    if (best) return best.v
  }

  const female = pool.find((v) => /xiaoxiao|xiaoyi|huihui|yaoyao|female|女/i.test(v.name))
  return female ?? pool[0]
}

const synthCache = new Map<string, string>()

export function useSpeech(callAudio = false): SpeechApi {
  const { character, settings } = useApp()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const amplitudeBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const amplitudeFrameRef = useRef(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const busyRef = useRef(false)
  const generationRef = useRef(0)

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const voice: CharacterVoice | undefined = character?.voice
  const ttsEnabled = settings?.voice.ttsEnabled ?? true

  const mode: SpeechApi['mode'] =
    !ttsEnabled || !voice || voice.engine === 'none'
      ? 'off'
      : voice.engine === 'inworld'
          ? 'inworld'
          : voice.engine === 'indextts'
            ? 'indextts'
            : voice.engine === 'gpt-sovits'
              ? 'gpt-sovits'
              : voice.engine === 'openai-local'
                ? 'openai-local'
                : voice.engine === 'http-local'
                  ? 'http-local'
          : 'synth'


  const progressRef = useRef<((p: number) => void) | null>(null)
  const amplitudeRef = useRef<((level: number) => void) | null>(null)
  const boundaryRef = useRef<(() => void) | null>(null)
  const setProgressCallback = useCallback((fn: ((p: number) => void) | null) => {
    progressRef.current = fn
  }, [])
  const setAmplitudeCallback = useCallback((fn: ((level: number) => void) | null) => {
    amplitudeRef.current = fn
  }, [])
  const setBoundaryCallback = useCallback((fn: (() => void) | null) => {
    boundaryRef.current = fn
  }, [])

  const playUrl = useCallback(async (url: string, rate: number, volume: number): Promise<boolean> => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      const el0 = audioRef.current
      try {
        const context = new AudioContext()
        if (callAudio && settings?.voiceCall.outputDeviceId && !('setSinkId' in context)) {
          void context.close()
          throw new Error('使用媒体元素直接选择输出设备')
        }
        const source = context.createMediaElementSource(el0)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0
        source.connect(analyser)
        analyser.connect(context.destination)
        audioContextRef.current = context
        analyserRef.current = analyser
        amplitudeBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      } catch {
        // Some system configurations block audio analysis; system TTS still reports word boundaries.
      }
      const sampleAmplitude = (): void => {
        if (el0.paused || el0.ended) {
          amplitudeFrameRef.current = 0
          amplitudeRef.current?.(0)
          return
        }
        const analyser = analyserRef.current
        const buffer = amplitudeBufferRef.current
        if (analyser && buffer) {
          analyser.getByteTimeDomainData(buffer)
          let energy = 0
          for (const sample of buffer) {
            const amplitude = (sample - 128) / 128
            energy += amplitude * amplitude
          }
          // Feed a normalized envelope from the playing waveform. A short attack and
          // slightly longer release keep quiet syllables visible without random motion.
          const rms = Math.sqrt(energy / buffer.length)
          amplitudeRef.current?.(Math.min(1, Math.max(0, (rms - 0.003) * 10)))
        }
        amplitudeFrameRef.current = window.requestAnimationFrame(sampleAmplitude)
      }
      el0.onended = () => {
        window.cancelAnimationFrame(amplitudeFrameRef.current)
        amplitudeRef.current?.(0)
        setSpeaking(false)
        progressRef.current?.(1)
      }
      el0.onplaying = () => {
        progressRef.current?.(0.001)
        window.cancelAnimationFrame(amplitudeFrameRef.current)
        amplitudeFrameRef.current = window.requestAnimationFrame(sampleAmplitude)
      }
      el0.onpause = () => {
        window.cancelAnimationFrame(amplitudeFrameRef.current)
        amplitudeRef.current?.(0)
      }
      el0.onerror = () => {
        setSpeaking(false)
        setLastError('音频播放失败')
        progressRef.current?.(1)
      }
      el0.ontimeupdate = () => {
        if (!el0.duration || !isFinite(el0.duration)) return
        if (!el0.paused) progressRef.current?.(Math.max(0.001, Math.min(1, el0.currentTime / el0.duration)))
      }
    }
    const el = audioRef.current
    el.src = url
    el.volume = Math.min(1, Math.max(0, volume / 100))
    el.playbackRate = Math.min(2, Math.max(0.5, rate))
    el.currentTime = 0
    setSpeaking(true)
    try {
      if (callAudio) await selectAudioOutput(settings?.voiceCall.outputDeviceId, el, audioContextRef.current)
      await audioContextRef.current?.resume()
      await el.play()
      return true
    } catch (err) {
      setSpeaking(false)
      amplitudeRef.current?.(0)
      setLastError('播放失败：' + (err instanceof Error ? err.message : String(err)))
      progressRef.current?.(1)
      return false
    }
  }, [callAudio, settings?.voiceCall.outputDeviceId])

  const stop = useCallback(() => {
    generationRef.current++
    busyRef.current = false
    progressRef.current?.(1)
    if (supported) window.speechSynthesis.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    window.cancelAnimationFrame(amplitudeFrameRef.current)
    amplitudeRef.current?.(0)
    setSpeaking(false)
  }, [supported])

  const speakInworld = useCallback(
    async (text: string): Promise<boolean> => {
      if (!voice) return false
      const generation = generationRef.current
      const key = `inworld|${voice.voiceId}|${voice.inworldModel}|${voice.rate}|${voice.pitch}|${text}`
      const hit = synthCache.get(key)
      if (hit) {
        return playUrl(hit, voice.rate, voice.volume)
      }

      setSpeaking(true)
      const res = await window.aimis.inworld.synthesize({
        text,
        voiceId: voice.voiceId,
        modelId: voice.inworldModel,
        rate: voice.rate,
        pitch: voice.pitch
      })
      if (generation !== generationRef.current) return false
      if (!res.ok || !res.data) {
        setSpeaking(false)
        setLastError('Inworld 合成失败：' + (res.error ?? '未知错误'))
        progressRef.current?.(1)
        return false
      }
      synthCache.set(key, res.data.url)
      if (synthCache.size > 80) {
        const first = synthCache.keys().next().value
        if (first) synthCache.delete(first)
      }
      return playUrl(res.data.url, voice.rate, voice.volume)
    },
    [voice, playUrl]
  )

  const speakIndexTts = useCallback(async (text: string): Promise<boolean> => {
    if (!voice) return false
    const generation = generationRef.current
    const refAudioPath = voice.localRefAudioPath || settings?.localTts.refAudioPath || ''
    const key = `indextts|${refAudioPath}|${text}`
    const hit = synthCache.get(key)
    if (hit) {
      return playUrl(hit, voice.rate, voice.volume)
    }
    setSpeaking(true)
    const res = await window.aimis.indexTts.synthesize(text, refAudioPath)
    if (generation !== generationRef.current) return false
    if (!res.ok || !res.data) {
      setSpeaking(false)
      throw new Error(res.error ?? 'IndexTTS 合成失败')
    }
    synthCache.set(key, res.data.url)
    return playUrl(res.data.url, voice.rate, voice.volume)
  }, [voice, settings?.localTts.refAudioPath, playUrl])

  const speakGptSovits = useCallback(async (text: string): Promise<boolean> => {
    if (!voice || !settings) return false
    const generation = generationRef.current
    const config = settings.localTts
    const refAudioPath = voice.localRefAudioPath || config.refAudioPath
    const refText = voice.localRefText || config.refText
    const key = `gpt-sovits|${config.gptSovitsEndpoint}|${refAudioPath}|${refText}|${config.gptSovitsTextLang}|${config.gptSovitsPromptLang}|${text}`
    const hit = synthCache.get(key)
    if (hit) return playUrl(hit, voice.rate, voice.volume)
    setSpeaking(true)
    const result = await window.aimis.gptSovits.synthesize(text, { refAudioPath, refText })
    if (generation !== generationRef.current) return false
    if (!result.ok || !result.data) {
      setSpeaking(false)
      throw new Error(result.error ?? 'GPT-SoVITS 合成失败')
    }
    synthCache.set(key, result.data.url)
    if (synthCache.size > 80) {
      const first = synthCache.keys().next().value
      if (first) synthCache.delete(first)
    }
    return playUrl(result.data.url, voice.rate, voice.volume)
  }, [voice, settings, playUrl])

  const speakLocalHttp = useCallback(async (text: string, engine: 'openai-local' | 'http-local'): Promise<boolean> => {
    if (!voice || !settings) return false
    const generation = generationRef.current
    const voiceId = engine === 'openai-local' ? voice.openAiTtsVoiceId : voice.genericTtsVoiceId
    const key = `${engine}|${JSON.stringify(settings.localTts)}|${voiceId || ''}|${text}`
    const hit = synthCache.get(key)
    if (hit) return playUrl(hit, voice.rate, voice.volume)
    setSpeaking(true)
    const result = await window.aimis.localHttpTts.synthesize({ engine, text, voiceId })
    if (generation !== generationRef.current) return false
    if (!result.ok || !result.data) {
      setSpeaking(false)
      throw new Error(result.error ?? '本地语音接口合成失败')
    }
    synthCache.set(key, result.data.url)
    if (synthCache.size > 80) synthCache.delete(synthCache.keys().next().value!)
    return playUrl(result.data.url, voice.rate, voice.volume)
  }, [voice, settings, playUrl])

  /**
   */

  const speakSynth = useCallback(
    (text: string): Promise<boolean> => {
      if (!supported || !voice) return Promise.resolve(false)
      const clean = text
        .replace(/[*#`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!clean) return Promise.resolve(false)

      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(clean)
      u.lang = 'zh-CN'
      u.rate = Math.min(2, Math.max(0.5, voice.rate))
      u.pitch = Math.min(2, Math.max(0, 1 + voice.pitch / 50))
      u.volume = Math.min(1, Math.max(0, voice.volume / 100))
      const picked = pickVoice(window.speechSynthesis.getVoices(), voice.voiceId)
      if (picked) {
        u.voice = picked
        u.lang = picked.lang
      }
      u.onboundary = (ev) => {
        const len = Math.max(1, clean.length)
        progressRef.current?.(Math.min(1, (ev.charIndex + 1) / len))
        boundaryRef.current?.()
      }
      setSpeaking(true)
      return new Promise<boolean>((resolveReady) => {
        let settled = false
        u.onstart = () => {
          progressRef.current?.(0.001)
          if (!settled) {
            settled = true
            resolveReady(true)
          }
        }
        u.onerror = () => {
          setSpeaking(false)
          setLastError('系统语音播放失败')
          progressRef.current?.(1)
          if (!settled) {
            settled = true
            resolveReady(false)
          }
        }
        u.onend = () => {
          setSpeaking(false)
          progressRef.current?.(1)
          if (!settled) {
            settled = true
            resolveReady(false)
          }
        }
        window.speechSynthesis.speak(u)
      })
    },
    [supported, voice]
  )

  /**
   */
  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      setLastError(null)
      if (mode === 'off') return false
      if (busyRef.current) return false
      text = text.replace(/```[\s\S]*?```/g, '').replace(/[*#`>]/g, '').trim()
      if (!text) { progressRef.current?.(1); return false }
      const generation = generationRef.current

      if (mode === 'inworld') {
        busyRef.current = true
        setLastError(null)
        try {
          return await speakInworld(text)
        } catch (error) {
          if (generation === generationRef.current) {
            setLastError(String(error))
            setSpeaking(false)
            progressRef.current?.(1)
          }
          return false
        } finally {
          if (generation === generationRef.current) busyRef.current = false
        }
      }

      if (mode === 'indextts') {
        busyRef.current = true
        try {
          return await speakIndexTts(text)
        } catch (error) {
          if (generation === generationRef.current) {
            setLastError(error instanceof Error ? error.message : String(error))
            setSpeaking(false)
            progressRef.current?.(1)
          }
          return false
        } finally {
          if (generation === generationRef.current) busyRef.current = false
        }
      }

      if (mode === 'gpt-sovits') {
        busyRef.current = true
        try {
          return await speakGptSovits(text)
        } catch (error) {
          if (generation === generationRef.current) {
            setLastError(error instanceof Error ? error.message : String(error))
            setSpeaking(false)
            progressRef.current?.(1)
          }
          return false
        } finally {
          if (generation === generationRef.current) busyRef.current = false
        }
      }

      if (mode === 'openai-local' || mode === 'http-local') {
        busyRef.current = true
        try {
          return await speakLocalHttp(text, mode)
        } catch (error) {
          if (generation === generationRef.current) {
            setLastError(error instanceof Error ? error.message : String(error))
            setSpeaking(false)
            progressRef.current?.(1)
          }
          return false
        } finally {
          if (generation === generationRef.current) busyRef.current = false
        }
      }

      return speakSynth(text)
    },
    [mode, speakInworld, speakIndexTts, speakGptSovits, speakLocalHttp, speakSynth]
  )

  const playAudioUrl = useCallback((url: string): Promise<boolean> => {
    if (!url) return Promise.resolve(false)
    if (busyRef.current) stop()
    return playUrl(url, voice?.rate ?? 1, voice?.volume ?? 100)
  }, [playUrl, stop, voice?.rate, voice?.volume])

  useEffect(() => {
    if (!supported) return
    const load = (): void => {
      window.speechSynthesis.getVoices()
    }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load)
      window.speechSynthesis.cancel()
    }
  }, [supported])

  useEffect(() => {
    return () => {
      generationRef.current++
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      void audioContextRef.current?.close()
    }
  }, [])

  return {
    speak,
    playAudioUrl,
    stop,
    supported,
    mode,
    lastError,
    speaking,
    onProgress: setProgressCallback,
    onAmplitude: setAmplitudeCallback,
    onBoundary: setBoundaryCallback
  }
}
