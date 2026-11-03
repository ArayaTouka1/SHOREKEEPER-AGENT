/**
 *
 */

import { JsonStore } from './store'
import type { ModelInfo, ModelState } from '../shared/types'
import { appFetch } from './network'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const BUILTIN_API_MODELS: ModelInfo[] = [
  {
    id: 'api_deepseek_v4_pro', name: 'DeepSeek V4 Pro', kind: 'api', provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', needKey: true, available: true
  },
  {
    id: 'api_deepseek_flash', name: 'DeepSeek V4.1 Flash', kind: 'api', provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', needKey: true, available: true
  },

  /* ---------------- OpenAI ---------------- */
  {
    id: 'api_openai_gpt4o',
    name: 'GPT-4o',
    kind: 'api',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needKey: true,
    available: true,
    note: '综合能力强，需海外网络'
  },
  {
    id: 'api_openai_gpt4o_mini',
    name: 'GPT-4o mini',
    kind: 'api',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needKey: true,
    available: true,
    note: '便宜快，日常够用'
  },
  {
    id: 'api_openai_gpt4_turbo',
    name: 'GPT-4 Turbo',
    kind: 'api',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4-turbo',
    needKey: true,
    available: true,
    note: '老牌稳定'
  },
  {
    id: 'api_openai_o1',
    name: 'o1',
    kind: 'api',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'o1',
    needKey: true,
    available: true,
    note: '深推理'
  },

  {
    id: 'api_kimi_k2',
    name: 'Kimi K2.6',
    kind: 'api',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    needKey: true,
    available: true,
    note: '通用旗舰，支持长上下文与工具调用'
  },
  {
    id: 'api_kimi_k3',
    name: 'Kimi K3',
    kind: 'api',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    needKey: true,
    available: true,
    note: '最新旗舰，适合复杂知识工作'
  },
  {
    id: 'api_kimi_long',
    name: 'Kimi 长文本',
    kind: 'api',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-128k',
    needKey: true,
    available: true,
    note: '128K 超长上下文'
  },
  {
    id: 'api_kimi_8k',
    name: 'Kimi 8K',
    kind: 'api',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    needKey: true,
    available: true,
    note: '便宜快'
  },

  {
    id: 'api_qwen_max',
    name: '通义千问 Max',
    kind: 'api',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    needKey: true,
    available: true,
    note: '旗舰'
  },
  {
    id: 'api_qwen_plus',
    name: '通义千问 Plus',
    kind: 'api',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    needKey: true,
    available: true,
    note: '均衡，阿里云百炼'
  },
  {
    id: 'api_qwen_turbo',
    name: '通义千问 Turbo',
    kind: 'api',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    needKey: true,
    available: true,
    note: '最快最便宜'
  },
  {
    id: 'api_qwen_coder',
    name: '通义千问 Coder',
    kind: 'api',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-coder-plus',
    needKey: true,
    available: true,
    note: '代码专项'
  },

  {
    id: 'api_glm4_plus',
    name: '智谱 GLM-4-Plus',
    kind: 'api',
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    needKey: true,
    available: true,
    note: '旗舰'
  },
  {
    id: 'api_glm4_flash',
    name: '智谱 GLM-4-Flash',
    kind: 'api',
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    needKey: true,
    available: true,
    note: '有免费额度'
  },
  {
    id: 'api_glm4_long',
    name: '智谱 GLM-4-Long',
    kind: 'api',
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-long',
    needKey: true,
    available: true,
    note: '超长上下文'
  },

  {
    id: 'api_siliconflow_ds',
    name: '硅基流动 · DeepSeek V4 Flash',
    kind: 'api',
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    needKey: true,
    available: true,
    note: '国内直连，聚合平台'
  },
  {
    id: 'api_siliconflow_qwen',
    name: '硅基流动 · 通义千问',
    kind: 'api',
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    needKey: true,
    available: true,
    note: '国内直连'
  },

  {
    id: 'api_minimax',
    name: 'MiniMax M3',
    kind: 'api',
    provider: 'minimax',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    needKey: true,
    available: true,
    note: '国产，中文口语好'
  },
  {
    id: 'api_baichuan',
    name: '百川 Baichuan4 Turbo',
    kind: 'api',
    provider: 'baichuan',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    model: 'Baichuan4-Turbo',
    needKey: true,
    available: true,
    note: '国产'
  },
  {
    id: 'api_step',
    name: '阶跃星辰',
    kind: 'api',
    provider: 'stepfun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-1-8k',
    needKey: true,
    available: true,
    note: '国产'
  },
  {
    id: 'api_doubao',
    name: '豆包',
    kind: 'api',
    provider: 'volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
    needKey: true,
    available: true,
    note: '字节，需填接入点 ID'
  },
  {
    id: 'api_hunyuan',
    name: '腾讯混元 Hy3',
    kind: 'api',
    provider: 'tencent',
    baseUrl: 'https://tokenhub.tencentmaas.com/v1',
    model: 'hy3-preview',
    needKey: true,
    available: true,
    note: '腾讯云'
  },
  {
    id: 'api_openrouter',
    name: 'OpenRouter',
    kind: 'api',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    needKey: true,
    available: true,
    note: '一个 Key 接多家模型'
  },
  {
    id: 'api_groq',
    name: 'Groq',
    kind: 'api',
    provider: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    needKey: true,
    available: true,
    note: '极快推理'
  }
]

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const BUILTIN_LOCAL_MODELS: ModelInfo[] = [
  {
    id: 'local_ollama',
    name: 'Ollama',
    kind: 'local',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    needKey: false,
    available: false,
    note: '本地部署，需先安装并启动 Ollama'
  },
  {
    id: 'local_lmstudio',
    name: 'LM Studio',
    kind: 'local',
    provider: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    needKey: false,
    available: false,
    note: '本地部署，在 LM Studio 里开启 Local Server'
  },
  {
    id: 'local_vllm',
    name: 'vLLM',
    kind: 'local',
    provider: 'vllm',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'default',
    needKey: false,
    available: false,
    note: '高性能本地推理服务'
  },
  {
    id: 'local_llamacpp',
    name: 'llama.cpp server',
    kind: 'local',
    provider: 'llamacpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'default',
    needKey: false,
    available: false,
    note: '轻量，CPU 也能跑'
  }
]

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const DEFAULT_STATE: ModelState = {
  activeId: 'api_deepseek_flash',
  custom: [],
  localConnections: {},
  providerKeys: {}
}

export const modelStore = new JsonStore<ModelState>('models', () => structuredClone(DEFAULT_STATE))

export function builtinModels(): ModelInfo[] {
  return [...BUILTIN_API_MODELS, ...BUILTIN_LOCAL_MODELS]
}

export const modelRepo = {
  state(): ModelState {
    const s = modelStore.read()
    let dirty = false
    if (s.activeId.startsWith('api_deepseek_') && !BUILTIN_API_MODELS.some(m => m.id === s.activeId)) {
      s.activeId = 'api_deepseek_flash'
      dirty = true
    }
    if (!Array.isArray(s.custom)) {
      s.custom = []
      dirty = true
    }
    if (!s.localConnections || typeof s.localConnections !== 'object') {
      s.localConnections = {}
      dirty = true
    }
    if (!s.providerKeys || typeof s.providerKeys !== 'object') {
      s.providerKeys = {}
      dirty = true
    }
    for (const builtin of builtinModels()) {
      const legacyKey = s.overrides?.[builtin.id]?.apiKey
      if (legacyKey !== undefined) {
        if (!s.providerKeys[builtin.provider] && legacyKey.trim()) s.providerKeys[builtin.provider] = legacyKey.trim()
        delete s.overrides![builtin.id].apiKey
        dirty = true
      }
    }
    if (s.overrides?.api_kimi_k2?.model === 'kimi-k2-0905-preview') {
      delete s.overrides.api_kimi_k2.model
      dirty = true
    }
    const retiredDefaults: Record<string, { baseUrl?: string; model?: string }> = {
      api_siliconflow_ds: { model: 'deepseek-ai/DeepSeek-V3' },
      api_minimax: { baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
      api_baichuan: { model: 'Baichuan4' },
      api_hunyuan: { baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbo' },
      api_openrouter: { model: 'anthropic/claude-3.5-sonnet' }
    }
    for (const [id, retired] of Object.entries(retiredDefaults)) {
      const override = s.overrides?.[id]
      if (!override) continue
      if (retired.baseUrl && override.baseUrl === retired.baseUrl) { delete override.baseUrl; dirty = true }
      if (retired.model && override.model === retired.model) { delete override.model; dirty = true }
    }
    if (dirty) modelStore.write(s)
    return s
  },

  list(): ModelInfo[] {
    const s = this.state()
    const all = [
      ...builtinModels().map(m => {
        const override = s.overrides?.[m.id]
        return { ...m, ...override, apiKey: override?.apiKey ?? s.providerKeys?.[m.provider] ?? m.apiKey }
      }),
      ...s.custom
    ]
    return all.map((m) => {
      if (m.kind !== 'local') return m
      const at = s.localConnections[m.id]
      return { ...m, available: !!at, connectedAt: at ?? undefined }
    })
  },

  /**
   */
  selectable(): ModelInfo[] {
    return this.list().filter((m) => (m.kind === 'api' ? true : m.available))
  },

  active(): ModelInfo {
    const s = this.state()
    const all = this.list()
    return all.find((m) => m.id === s.activeId) ?? BUILTIN_API_MODELS[0]
  },

  setActive(id: string): ModelState {
    const target = this.list().find(m => m.id === id)
    if (!target) throw new Error('模型不存在')
    if (target.kind === 'local' && !target.available) throw new Error('请先连接此本地模型')
    return modelStore.update((s) => {
      s.activeId = id
    })
  },

  markConnected(id: string, ok: boolean): ModelState {
    return modelStore.update((s) => {
      if (ok) s.localConnections[id] = Date.now()
      else delete s.localConnections[id]
    })
  },

  /**
   */
  disconnect(id: string): ModelState {
    return modelStore.update((s) => {
      delete s.localConnections[id]
      if (s.activeId === id) {
        const fallback = BUILTIN_API_MODELS[0]
        s.activeId = fallback ? fallback.id : 'api_deepseek_flash'
      }
    })
  },

  disconnectAll(): ModelState {
    return modelStore.update((s) => {
      const wasLocal = s.activeId.startsWith('local_') || !!s.localConnections[s.activeId]
      s.localConnections = {}
      if (wasLocal) {
        const fallback = BUILTIN_API_MODELS[0]
        s.activeId = fallback ? fallback.id : 'api_deepseek_flash'
      }
    })
  },

  addModel(input: {
    name: string
    kind: 'api' | 'local'
    baseUrl: string
    model: string
    apiKey?: string
    note?: string
  }): ModelInfo {
    if (!/^https?:\/\//.test(input.baseUrl.trim()) || !input.model.trim()) throw new Error('需要有效的服务地址与模型标识')
    const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const m: ModelInfo = {
      id,
      name: input.name.trim() || '自定义模型',
      kind: input.kind,
      provider: 'custom',
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      needKey: input.kind === 'api',
      available: input.kind === 'api',
      note: input.note ?? '用户添加',
      apiKey: input.apiKey?.trim()
    }
    modelStore.update((s) => {
      s.custom.push(m)
    })
    return m
  },

  removeModel(id: string): ModelState {
    return modelStore.update((s) => {
      s.custom = s.custom.filter((m) => m.id !== id)
      delete s.localConnections[id]
      if (s.activeId === id) s.activeId = 'api_deepseek_flash'
    })
  },

  updateModel(id: string, patch: Partial<ModelInfo>): ModelState {
    return modelStore.update((s) => {
      const idx = s.custom.findIndex((m) => m.id === id)
      const allowed = { ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl.trim() } : {}), ...(patch.model !== undefined ? { model: patch.model.trim() } : {}), ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey.trim() } : {}) }
      if (allowed.baseUrl !== undefined && !/^https?:\/\//.test(allowed.baseUrl)) throw new Error('Base URL 必须使用 HTTP 或 HTTPS')
      if (allowed.model !== undefined && !allowed.model) throw new Error('模型标识不能为空')
      if (idx >= 0) s.custom[idx] = { ...s.custom[idx], ...allowed, id }
      else if (builtinModels().some(m => m.id === id)) {
        const builtin = builtinModels().find(m => m.id === id)!
        s.overrides ??= {}
        s.providerKeys ??= {}
        if (allowed.apiKey !== undefined) s.providerKeys[builtin.provider] = allowed.apiKey
        const perModel = { ...allowed }
        delete perModel.apiKey
        const previous = { ...s.overrides[id] }
        delete previous.apiKey
        s.overrides[id] = { ...previous, ...perModel }
      }
      else throw new Error('模型不存在')
      delete s.localConnections[id]
    })
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 * 探测一个 OpenAI 兼容端点是否可用。
 *
 * 判定策略（重要）：
 *   `/models` 返回的列表**不能**作为「模型是否可用」的判据 —— 很多服务商
 *   （Kimi / 部分中转站）的列表不完整或滞后，模型实际可以调用却不在列表里。
 *   之前的实现直接判失败，表现为「服务可达，但模型 ID 不在列表中」的误报。
 *
 * 现在的顺序：
 *   1. 有 model 时：直接发一次最小 chat/completions —— 成功即可用（权威判据）
 *   2. 鉴权/额度类错误（401/403/402）如实报错
 *   3. 没给 model 时：才用 /models 列表判断服务是否可达
 */
export async function probeEndpoint(
  baseUrl: string, apiKey: string | undefined, timeoutMs = 15000, model?: string
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const base = baseUrl.replace(/\/+$/, '')
  const auth: Record<string, string> = apiKey ? { Authorization: 'Bearer ' + apiKey } : {}

  /** 拉一次 /models（仅用于展示与辅助判断，失败不影响结论） */
  const listModels = async (): Promise<string[]> => {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), Math.min(timeoutMs, 8000))
      try {
        const res = await appFetch(base + '/models', { signal: ctl.signal, headers: auth })
        if (!res.ok) return []
        const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
        return Array.isArray(body?.data) ? body.data.map((m) => String(m.id ?? '')).filter(Boolean) : []
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return []
    }
  }

  // 1) 有 model：实测调用（权威判据）
  if (model) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const chat = await appFetch(base + '/chat/completions', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false })
      })
      if (chat.ok) {
        const models = await listModels()
        return { ok: true, message: '连接成功，模型可调用：' + model, models }
      }
      // 读错误体，给出服务商的原始说明
      let detail = ''
      try {
        const text = await chat.text()
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
        detail = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 200)
      } catch {
        /* 忽略解析失败 */
      }
      const status = chat.status
      // 鉴权 / 额度问题：明确告知，不要误导成「模型不存在」
      if (status === 401 || status === 403) {
        return { ok: false, message: 'API Key 无效或无权限（HTTP ' + status + '）' + (detail ? '：' + detail : '') }
      }
      if (status === 402) {
        return { ok: false, message: '账户额度不足（HTTP 402）' + (detail ? '：' + detail : '') }
      }
      if (status === 404) {
        // 404 可能是模型名错，也可能是端点不支持 chat/completions
        const models = await listModels()
        return {
          ok: false,
          message: '模型不存在或端点不支持 chat/completions（HTTP 404）' + (detail ? '：' + detail : ''),
          models
        }
      }
      if (status === 429) {
        // 限流说明 key 和模型都是对的，只是请求太频
        const models = await listModels()
        return { ok: true, message: '连接成功（当前被限流，模型可用）：' + model, models }
      }
      const models = await listModels()
      return { ok: false, message: '模型调用失败，HTTP ' + status + (detail ? '：' + detail : ''), models }
    } catch (error) {
      return {
        ok: false,
        message: ctl.signal.aborted ? '模型探测超时（' + timeoutMs + 'ms）' : '模型探测失败：' + String(error instanceof Error ? error.message : error)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // 2) 没给 model：用 /models 判断服务可达性
  const models = await listModels()
  if (models.length) return { ok: true, message: '服务可达，可用模型 ' + models.length + ' 个', models }
  return { ok: false, message: '服务不可达，或未返回可用模型列表' }
}
