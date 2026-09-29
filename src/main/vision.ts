/**
 *
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.includes(extname(path).toLowerCase())
}

function imageToDataUrl(path: string): string {
  const buf = readFileSync(path)
  const ext = extname(path).toLowerCase().replace('.', '') || 'png'
  const mime = ext === 'jpg' ? 'jpeg' : ext
  return `data:image/${mime};base64,${buf.toString('base64')}`
}

export interface VisionConfig {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
}

/**
 *
 */
export async function describeImage(path: string, cfg: VisionConfig, prompt?: string): Promise<string> {
  const dataUrl = imageToDataUrl(path)
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
  const instruction =
    prompt ??
    '请客观、详细地描述这张图片的内容：画面主体、人物或物体、动作、场景、文字（如有）、整体氛围。用于让一个 AI 陪伴角色理解用户发来的图片。不要臆测图片之外的信息。'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens || 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`识图请求失败 HTTP ${res.status}：${body.slice(0, 200)}`)
  }

  const json: any = await res.json().catch(() => null)
  const text: string = json?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('识图返回为空')
  return text
}

export function visionConfigOf(llm: { baseUrl: string; apiKey: string; model: string; visionModel?: string; maxTokens: number }): VisionConfig {
  return {
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    model: llm.visionModel?.trim() || llm.model,
    maxTokens: llm.maxTokens
  }
}
