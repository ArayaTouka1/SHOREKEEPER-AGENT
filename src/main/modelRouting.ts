import type { AppSettings, ModelInfo } from '../shared/types'

export function modelRoute(model: ModelInfo, settings: AppSettings): { baseUrl: string; model: string; apiKey: string } {
  let sameEndpoint = false
  try { sameEndpoint = new URL(model.baseUrl).origin === new URL(settings.llm.baseUrl).origin } catch { /* Invalid URLs are rejected at request time. */ }
  const apiKey = model.apiKey?.trim() || (sameEndpoint ? settings.llm.apiKey.trim() : '')
  if (model.needKey && !apiKey) throw new Error(`模型 ${model.name} 未配置此服务的 API Key，请在模型设置中填写。`)
  if (model.kind === 'local' && !model.available) throw new Error(`本地模型 ${model.name} 尚未连接`)
  return { baseUrl: model.baseUrl, model: model.model, apiKey }
}
