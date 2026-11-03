import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalTtsConfig } from '../shared/types'
import { appFetch } from './network'
import { allowFile, toAppFileUrl } from './localFile'

type LocalHttpEngine = 'openai-local' | 'http-local'

function endpointOf(value: string): URL {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('本地语音接口须使用 HTTP(S) 地址，且不能在地址中包含用户名或密码')
  }
  return url
}

function replaceTokens(value: unknown, text: string, voice: string): unknown {
  if (typeof value === 'string') return value.replaceAll('{{text}}', text).replaceAll('{{voice}}', voice)
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, text, voice))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, text, voice)]))
  }
  return value
}

function audioExtension(contentType: string, data: Buffer): string {
  if (/mpeg|mp3/i.test(contentType) || data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return 'mp3'
  if (/wav|wave/i.test(contentType) || data.toString('ascii', 0, 4) === 'RIFF') return 'wav'
  if (/ogg|opus/i.test(contentType) || data.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (/flac/i.test(contentType) || data.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  if (/aac/i.test(contentType)) return 'aac'
  if (/mp4|m4a/i.test(contentType) || data.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
  throw new Error('接口未返回可播放音频，请检查响应格式（支持 MP3、WAV、OGG、FLAC、AAC、M4A）')
}

export async function synthesizeLocalHttpTts(
  config: LocalTtsConfig,
  engine: LocalHttpEngine,
  text: string,
  voiceOverride?: string
): Promise<{ path: string; url: string; bytes: number }> {
  const cleanText = text.trim()
  if (!cleanText) throw new Error('没有可合成的文本')
  const isOpenAi = engine === 'openai-local'
  const voice = voiceOverride?.trim() || (isOpenAi ? config.openAiTtsVoice : config.genericTtsVoice).trim()
  const rawEndpoint = isOpenAi ? config.openAiTtsEndpoint : config.genericTtsEndpoint
  const hasEndpointTokens = rawEndpoint.includes('{{text}}') || rawEndpoint.includes('{{voice}}')
  const endpoint = endpointOf(!isOpenAi && config.genericTtsMethod === 'GET'
    ? rawEndpoint.replaceAll('{{text}}', encodeURIComponent(cleanText)).replaceAll('{{voice}}', encodeURIComponent(voice))
    : rawEndpoint)
  const apiKey = isOpenAi ? config.openAiTtsApiKey : config.genericTtsApiKey
  const headers: Record<string, string> = {}
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  let method = 'POST'
  let body: string | undefined
  if (isOpenAi) {
    body = JSON.stringify({ model: config.openAiTtsModel.trim(), input: cleanText, voice, response_format: 'mp3' })
  } else if (config.genericTtsMethod === 'GET') {
    method = 'GET'
    if (!hasEndpointTokens) {
      endpoint.searchParams.set('text', cleanText)
      if (voice) endpoint.searchParams.set('voice', voice)
    }
  } else {
    let template: unknown
    try { template = JSON.parse(config.genericTtsBody) } catch { throw new Error('通用接口的请求体不是有效 JSON') }
    body = JSON.stringify(replaceTokens(template, cleanText, voice))
  }
  if (body) headers['Content-Type'] = 'application/json'
  const response = await appFetch(endpoint, { method, headers, body, signal: AbortSignal.timeout(10 * 60_000) })
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`本地语音接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`)
  }
  let audio: Buffer
  let detectedType = contentType
  if (!isOpenAi && config.genericTtsResponse === 'base64') {
    const json = await response.json() as Record<string, unknown>
    const value = config.genericTtsBase64Field.split('.').filter(Boolean).reduce<unknown>((item, key) =>
      item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined, json)
    if (typeof value !== 'string' || !value.trim()) throw new Error(`响应中没有找到 Base64 字段：${config.genericTtsBase64Field}`)
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(value)
    if (match) detectedType = match[1]
    const encoded = match ? match[2] : value
    audio = Buffer.from(encoded, 'base64')
  } else {
    if (/json|text\//i.test(contentType)) throw new Error(`接口返回了 ${contentType || '文本'}，预期为音频；请检查请求参数或选择 Base64 JSON 响应`)
    audio = Buffer.from(await response.arrayBuffer())
  }
  if (audio.length < 32 || audio.length > 50 * 1024 * 1024) throw new Error('接口返回的音频为空或超过 50 MB')
  const extension = audioExtension(detectedType, audio)
  const key = createHash('sha256').update(JSON.stringify([engine, endpoint.toString(), config, voice, cleanText])).digest('hex')
  const directory = join(app.getPath('userData'), 'tts-cache', engine)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${key}.${extension}`)
  if (!existsSync(path)) writeFileSync(path, audio)
  allowFile(path)
  return { path, url: toAppFileUrl(path), bytes: audio.length }
}
