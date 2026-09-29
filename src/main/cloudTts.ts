/**
 *
 *
 */

import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CloudTtsConfig, TtsProvider } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const INWORLD_MODELS = ['inworld-tts-2', 'inworld-tts-1-max', 'inworld-tts-1'] as const

export const OPENAI_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const

export const PROVIDER_DEFAULTS: Record<
  TtsProvider,
  { baseUrl: string; authMode: 'basic' | 'bearer' | 'none'; model: string; label: string; hint: string }
> = {
  inworld: {
    baseUrl: 'https://api.inworld.ai',
    authMode: 'basic',
    model: 'inworld-tts-2',
    label: 'Inworld',
    hint: '填 Inworld 的 Basic 认证串（key:secret 的 base64）'
  },
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    authMode: 'bearer',
    model: 'tts-1',
    label: 'OpenAI 兼容',
    hint: '填 Bearer Token。适用于 OpenAI / 硅基流动 / 自建 One-API 等'
  },
  custom: {
    baseUrl: '',
    authMode: 'bearer',
    model: '',
    label: '自定义',
    hint: '完全自填接口地址、鉴权方式与模型'
  }
}

export function builtinModelsOf(provider: TtsProvider): string[] {
  if (provider === 'inworld') return [...INWORLD_MODELS]
  if (provider === 'openai-compatible') return [...OPENAI_TTS_MODELS]
  return []
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function ttsCacheDir(): string {
  const dir = join(app.getPath('userData'), 'tts-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function pruneTtsCache(keep = 60): number {
  const dir = ttsCacheDir()
  try {
    const files = readdirSync(dir)
      .map((f) => ({ f, p: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    let removed = 0
    for (const item of files.slice(keep)) {
      try {
        unlinkSync(item.p)
        removed++
      } catch {
        /* ignore */
      }
    }
    return removed
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface CloudVoice {
  voiceId: string
  displayName: string
  langCode: string
  source: 'IVC' | 'SYSTEM' | string
  gender: string
  description: string
  owned: boolean
}

interface InworldVoicesResponse {
  voices?: Array<{
    voiceId?: string
    displayName?: string
    langCode?: string
    source?: string
    gender?: string
    description?: string
    owned?: boolean
  }>
  nextPageToken?: string
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

function authHeaders(cfg: CloudTtsConfig): Record<string, string> {
  const key = (cfg.apiKey ?? '').trim()
  if (!key || cfg.authMode === 'none') return {}
  if (cfg.authMode === 'basic') return { Authorization: `Basic ${key}` }
  return { Authorization: `Bearer ${key}` }
}

/**
 */
export async function listCloudVoices(cfg: CloudTtsConfig): Promise<CloudVoice[]> {
  if (cfg.provider === 'inworld') return listInworldVoices(cfg)

  const base = (cfg.baseUrl ?? '').trim()
  if (!base) return []
  const candidates = cfg.voicesPath?.trim()
    ? [cfg.voicesPath.trim()]
    : ['audio/voices', 'voices', 'models']

  for (const path of candidates) {
    try {
      const res = await fetch(joinUrl(base, path), { headers: authHeaders(cfg) })
      if (!res.ok) continue
      const json: any = await res.json().catch(() => null)
      if (!json) continue

      const raw: any[] = Array.isArray(json) ? json : (json.data ?? json.voices ?? [])
      const list: CloudVoice[] = []
      for (const v of raw) {
        const id = String(v?.id ?? v?.voiceId ?? v?.name ?? '').trim()
        if (!id) continue
        list.push({
          voiceId: id,
          displayName: String(v?.name ?? v?.displayName ?? id),
          langCode: String(v?.lang ?? v?.langCode ?? ''),
          source: 'SYSTEM',
          gender: String(v?.gender ?? ''),
          description: String(v?.description ?? ''),
          owned: false
        })
      }
      if (list.length) return list
    } catch {
    }
  }
  return []
}

async function listInworldVoices(cfg: CloudTtsConfig): Promise<CloudVoice[]> {
  const key = (cfg.apiKey ?? '').trim()
  if (!key) throw new Error('没有配置 API Key')

  const endpoint = joinUrl(cfg.baseUrl || PROVIDER_DEFAULTS.inworld.baseUrl, 'voices/v1/voices')
  const out: CloudVoice[] = []
  let pageToken = ''

  for (let page = 0; page < 10; page++) {
    const url = pageToken ? `${endpoint}?pageToken=${encodeURIComponent(pageToken)}` : endpoint
    const res = await fetch(url, { headers: authHeaders(cfg) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`拉取音色失败 ${res.status}：${body.slice(0, 200)}`)
    }
    const json = (await res.json()) as InworldVoicesResponse
    for (const v of json.voices ?? []) {
      const voiceId = v.voiceId ?? ''
      if (!voiceId) continue
      let name = (v.displayName ?? '').trim()
      if (!name || /[\uFFFD]|Ã|Â|å|æ|ç/.test(name)) {
        name = voiceId.includes('__') ? voiceId.split('__').pop()! : voiceId
      }
      out.push({
        voiceId,
        displayName: name,
        langCode: v.langCode ?? '',
        source: v.source ?? '',
        gender: v.gender ?? '',
        description: v.description ?? '',
        owned: v.owned === true || v.source === 'IVC'
      })
    }
    pageToken = json.nextPageToken ?? ''
    if (!pageToken) break
  }

  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface SynthesizeOptions {
  config: CloudTtsConfig
  text: string
  voiceId: string
  modelId?: string
  rate?: number
  pitch?: number
  sampleRate?: number
}

export interface SynthesizeResult {
  path: string
  bytes: number
  voiceId: string
  modelId: string
  provider: TtsProvider
  usage: unknown
}

/**
 */
export async function synthesize(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const cfg = opts.config
  const text = opts.text.trim()
  if (!text) throw new Error('要合成的文本为空')
  if (!opts.voiceId.trim()) throw new Error('没有指定音色')

  if (cfg.provider === 'inworld') return synthesizeInworld(opts)
  return synthesizeOpenAICompatible(opts)
}

async function synthesizeInworld(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const cfg = opts.config
  const apiKey = (cfg.apiKey ?? '').trim()
  if (!apiKey) throw new Error('没有配置 API Key')
  const text = opts.text.trim()
  const modelId = opts.modelId || cfg.model || 'inworld-tts-2'
  const base = (cfg.baseUrl || PROVIDER_DEFAULTS.inworld.baseUrl).trim()

  const payload: Record<string, unknown> = {
    text,
    voiceId: opts.voiceId.trim(),
    modelId,
    audioConfig: { audioEncoding: 'MP3', sampleRateHertz: opts.sampleRate ?? 24000 }
  }
  if (opts.rate && Math.abs(opts.rate - 1) > 0.01) {
    payload.speakingRate = Math.min(1.5, Math.max(0.5, opts.rate))
  }
  if (opts.pitch && Math.abs(opts.pitch) > 0.5) {
    payload.pitch = Math.max(-12, Math.min(12, opts.pitch / 4))
  }

  const res = await fetch(joinUrl(base, 'tts/v1/voice'), {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`合成失败 ${res.status}：${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as { audioContent?: string; usage?: unknown }
  const b64 = json.audioContent ?? ''
  if (!b64) {
    throw new Error(
      '服务端返回了空音频。常见原因：音色不支持该语言（克隆音色需与参考音频语种一致），或账号额度不足。'
    )
  }

  const buf = Buffer.from(b64, 'base64')
  return { ...writeCache(buf), voiceId: opts.voiceId.trim(), modelId, provider: 'inworld', usage: json.usage ?? null }
}

async function synthesizeOpenAICompatible(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const cfg = opts.config
  const base = (cfg.baseUrl ?? '').trim()
  if (!base) throw new Error('没有配置接口地址（Base URL）')
  if (cfg.authMode !== 'none' && !(cfg.apiKey ?? '').trim()) throw new Error('没有配置 API Key')

  const modelId = opts.modelId || cfg.model
  if (!modelId) throw new Error('没有指定模型')

  const path = cfg.speechPath?.trim() || 'audio/speech'
  const payload: Record<string, unknown> = {
    model: modelId,
    input: opts.text.trim(),
    voice: opts.voiceId.trim(),
    response_format: 'mp3'
  }
  if (opts.rate && Math.abs(opts.rate - 1) > 0.01) {
    payload.speed = Math.min(4, Math.max(0.25, opts.rate))
  }

  const res = await fetch(joinUrl(base, path), {
    method: 'POST',
    headers: { ...authHeaders(cfg), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`合成失败 ${res.status}：${body.slice(0, 300)}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('服务端返回了空音频')

  return { ...writeCache(buf), voiceId: opts.voiceId.trim(), modelId, provider: cfg.provider, usage: null }
}

function writeCache(buf: Buffer): { path: string; bytes: number } {
  const name = `tts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.mp3`
  const path = join(ttsCacheDir(), name)
  writeFileSync(path, buf)
  return { path, bytes: buf.length }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface TestResult {
  ok: boolean
  message: string
  voices: number
}

export async function testConnection(cfg: CloudTtsConfig): Promise<TestResult> {
  if (cfg.provider === 'inworld') {
    try {
      const voices = await listInworldVoices(cfg)
      return { ok: true, message: `连通正常，发现 ${voices.length} 个音色`, voices: voices.length }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), voices: 0 }
    }
  }

  const base = (cfg.baseUrl ?? '').trim()
  if (!base) return { ok: false, message: '请先填写接口地址（Base URL）', voices: 0 }

  try {
    const voices = await listCloudVoices(cfg)
    if (voices.length) {
      return { ok: true, message: `连通正常，发现 ${voices.length} 个音色`, voices: voices.length }
    }
  } catch {
  }

  if (!cfg.model || !cfg.voiceId) {
    return {
      ok: true,
      message: '端点可达（未取到音色列表，请手填模型与音色名）',
      voices: 0
    }
  }

  try {
    await synthesize({ config: cfg, text: '测试', voiceId: cfg.voiceId, modelId: cfg.model })
    return { ok: true, message: '连通正常，合成测试成功', voices: 0 }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), voices: 0 }
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function defaultCloudConfig(provider: TtsProvider = 'inworld'): CloudTtsConfig {
  const d = PROVIDER_DEFAULTS[provider]
  return {
    provider,
    apiKey: '',
    baseUrl: d.baseUrl,
    model: d.model,
    authMode: d.authMode,
    customModels: [],
    voicesPath: '',
    speechPath: '',
    voiceId: '',
    verified: false
  }
}
