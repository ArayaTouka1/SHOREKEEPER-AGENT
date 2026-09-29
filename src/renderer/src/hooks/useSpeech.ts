import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { CharacterVoice } from '../../../shared/types'

/**
 *
 *
 */

export interface SpeechApi {
  speak: (text: string) => void
  playPack: () => void
  stop: () => void
  supported: boolean
  mode: 'pack' | 'inworld' | 'synth' | 'off'
  lastError: string | null
  onProgress: (fn: ((p: number) => void) | null) => void
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

export function useSpeech(): SpeechApi {
  const { character, settings } = useApp()
  const audioRef = useRef<HTMLAudioElement | null>(null)
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
      : voice.engine === 'voice-pack'
        ? 'pack'
        : voice.engine === 'inworld'
          ? 'inworld'
          : 'synth'


  const progressRef = useRef<((p: number) => void) | null>(null)

  const playUrl = useCallback((url: string, rate: number, volume: number) => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      const el0 = audioRef.current
      el0.onended = () => {
        setSpeaking(false)
        progressRef.current?.(1)
      }
      el0.onplaying = () => progressRef.current?.(0.001)
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
    void el
      .play()
      .catch((err) => {
        setSpeaking(false)
        setLastError('播放失败：' + (err instanceof Error ? err.message : String(err)))
        progressRef.current?.(1)
      })
  }, [])

  const stop = useCallback(() => {
    generationRef.current++
    busyRef.current = false
    progressRef.current?.(1)
    if (supported) window.speechSynthesis.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setSpeaking(false)
  }, [supported])

  const playPack = useCallback(() => {
    if (!voice) return
    setLastError(null)
    const generation = generationRef.current
    void window.aimis.voice
      .resolve({ voicePackFile: voice.voicePackFile, customPackPath: voice.customPackPath })
      .then((res) => {
        if (generation !== generationRef.current) return
        if (!res.ok || !res.data) {
          setLastError(
            voice.voicePackFile
              ? `找不到语音包文件：${voice.voicePackFile}`
              : '这个角色还没有绑定语音包，去「设置 → 语音」选一个'
          )
          return
        }
        playUrl('file:///' + String(res.data).replace(/\\/g, '/'), voice.rate, voice.volume)
      })
  }, [voice, playUrl])

  const speakInworld = useCallback(
    async (text: string) => {
      if (!voice) return
      const generation = generationRef.current
      const key = `inworld|${voice.voiceId}|${voice.inworldModel}|${voice.rate}|${voice.pitch}|${text}`
      const hit = synthCache.get(key)
      if (hit) {
        playUrl(hit, voice.rate, voice.volume)
        return
      }

      setSpeaking(true)
      const res = await window.aimis.inworld.synthesize({
        text,
        voiceId: voice.voiceId,
        modelId: voice.inworldModel,
        rate: voice.rate,
        pitch: voice.pitch
      })
      if (generation !== generationRef.current) return
      if (!res.ok || !res.data) {
        setSpeaking(false)
        setLastError('Inworld 合成失败：' + (res.error ?? '未知错误'))
        progressRef.current?.(1)
        return
      }
      synthCache.set(key, res.data.url)
      if (synthCache.size > 80) {
        const first = synthCache.keys().next().value
        if (first) synthCache.delete(first)
      }
      playUrl(res.data.url, voice.rate, voice.volume)
    },
    [voice, playUrl]
  )

  /**
   */

  const speakSynth = useCallback(
    (text: string) => {
      if (!supported || !voice) return
      const clean = text
        .replace(/[*#`>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!clean) return

      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(clean)
      u.lang = 'zh-CN'
      u.rate = Math.min(2, Math.max(0.5, voice.rate))
      u.pitch = Math.min(2, Math.max(0, 1 + voice.pitch / 50))
      u.volume = Math.min(1, Math.max(0, voice.volume / 100))
      u.onstart = () => progressRef.current?.(0.001)
      u.onerror = () => {
        setSpeaking(false)
        setLastError('系统语音播放失败')
        progressRef.current?.(1)
      }

      const picked = pickVoice(window.speechSynthesis.getVoices(), voice.voiceId)
      if (picked) {
        u.voice = picked
        u.lang = picked.lang
      }
      u.onboundary = (ev) => {
        const len = Math.max(1, clean.length)
        progressRef.current?.(Math.min(1, (ev.charIndex + 1) / len))
      }
      u.onend = () => {
        setSpeaking(false)
        progressRef.current?.(1)
      }
      setSpeaking(true)
      window.speechSynthesis.speak(u)
    },
    [supported, voice]
  )

  /**
   */
  const speak = useCallback(
    (text: string) => {
      setLastError(null)
      if (mode === 'off') return
      if (busyRef.current) return
      text = text.replace(/```[\s\S]*?```/g, '').replace(/[*#`>]/g, '').trim()
      if (!text) { progressRef.current?.(1); return }
      const generation = generationRef.current

      if (mode === 'pack') {
        playPack()
        return
      }

      if (mode === 'inworld') {
        busyRef.current = true
        setLastError(null)
        void speakInworld(text).catch(error => {
          if (generation === generationRef.current) {
            setLastError(String(error))
            setSpeaking(false)
            progressRef.current?.(1)
          }
        }).finally(() => {
          if (generation === generationRef.current) busyRef.current = false
        })
        return
      }

      speakSynth(text)
    },
    [mode, playPack, speakInworld, speakSynth]
  )

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
    }
  }, [])

  return {
    speak,
    playPack,
    stop,
    supported,
    mode,
    lastError,
    speaking,
    onProgress: (fn: ((p: number) => void) | null) => {
      progressRef.current = fn
    }
  }
}
