import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalTtsConfig } from '../shared/types'
import { appFetch } from './network'
import { allowFile, toAppFileUrl } from './localFile'

function endpointOf(value: string): string {
  const endpoint = new URL(value.trim())
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('GPT-SoVITS API 地址必须使用 HTTP 或 HTTPS')
  }
  if (endpoint.username || endpoint.password) throw new Error('API 地址中不能包含用户名或密码')
  return endpoint.toString().replace(/\/+$/, '')
}

function routeOf(base: string, path: string): string {
  const route = path.trim() || '/tts'
  if (!/^\/[\w./-]*$/.test(route) || route.includes('..')) throw new Error('API 路径无效，请填写类似 /tts 的路径')
  return `${base}/${route.replace(/^\/+/, '')}`
}

export async function probeGptSovits(endpoint: string, probePath = '/docs'): Promise<{ ok: boolean; message: string }> {
  const base = endpointOf(endpoint)
  const response = await appFetch(routeOf(base, probePath), { method: 'GET', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`API 返回 ${response.status}`)
  return { ok: true, message: `GPT-SoVITS API 已连接：${new URL(base).host}` }
}

export async function synthesizeGptSovits(
  config: LocalTtsConfig,
  text: string
): Promise<{ path: string; url: string; bytes: number }> {
  const cleanText = text.trim()
  if (!cleanText) throw new Error('没有可合成的文本')
  const referencePath = config.refAudioPath.trim()
  if (!referencePath || !existsSync(referencePath)) throw new Error('请先选择有效的 GPT-SoVITS 参考音频')
  if (!config.refText.trim()) throw new Error('请填写参考音频对应的文本')

  const base = endpointOf(config.gptSovitsEndpoint)
  const payload = {
    text: cleanText,
    text_lang: config.gptSovitsTextLang || 'zh',
    ref_audio_path: referencePath,
    prompt_text: config.refText.trim(),
    prompt_lang: config.gptSovitsPromptLang || 'zh',
    text_split_method: 'cut5',
    batch_size: 1,
    media_type: 'wav',
    streaming_mode: false
  }
  const response = await appFetch(routeOf(base, config.gptSovitsTtsPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10 * 60_000)
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || contentType.includes('application/json')) {
    const error = await response.text().catch(() => '')
    let detail = error.slice(0, 1000)
    try {
      const parsed = JSON.parse(error) as { message?: string; Exception?: string; detail?: string }
      detail = parsed.message ?? parsed.Exception ?? parsed.detail ?? detail
    } catch {
    }
    throw new Error(`GPT-SoVITS 合成失败（HTTP ${response.status}）：${detail || 'API 未返回音频'}`)
  }

  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('GPT-SoVITS 返回的数据不是有效 WAV 音频')
  }

  const cacheDir = join(app.getPath('userData'), 'tts-cache', 'gpt-sovits')
  mkdirSync(cacheDir, { recursive: true })
  const key = createHash('sha256').update(JSON.stringify([base, referencePath, config.refText, payload])).digest('hex')
  const path = join(cacheDir, `${key}.wav`)
  if (!existsSync(path)) writeFileSync(path, audio)
  allowFile(path)
  return { path, url: toAppFileUrl(path), bytes: audio.length }
}
