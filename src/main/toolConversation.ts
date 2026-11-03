import type { AgentToolSpec } from '../shared/types'
import { appFetch } from './network'

export interface ToolConversationOptions {
  url: string
  apiKey: string
  model: string
  messages: any[]
  signal: AbortSignal
  maxTokens: number
  stream?: boolean
  temperature?: number
  onDelta?: (text: string) => void
  tools: AgentToolSpec[]
  execute(name: string, params: Record<string, unknown>): Promise<string>
}

type Completion = { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }

async function readCompletion(response: Response, options: ToolConversationOptions): Promise<Completion> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    const body = await response.json() as any
    const message = body?.choices?.[0]?.message as Completion | undefined
    if (!message) throw new Error('模型没有返回有效消息')
    if (typeof message.content === 'string' && message.content) options.onDelta?.(message.content)
    return message
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const calls = new Map<number, NonNullable<Completion['tool_calls']>[number]>()
  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    const body = JSON.parse(payload)
    if (body.error) throw new Error(body.error.message || '模型返回流式错误')
    const delta = body.choices?.[0]?.delta
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      options.onDelta?.(delta.content)
    }
    for (const part of delta.tool_calls ?? []) {
      const index = Number(part.index ?? 0)
      const call = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
      if (part.id) call.id = part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
      calls.set(index, call)
    }
  }
  try {
    while (true) {
      options.signal.throwIfAborted()
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      lines.forEach(consume)
      if (done) { if (buffer) consume(buffer); break }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error('模型返回了不完整的工具调用')
  return { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }
}

export async function toolConversation(options: ToolConversationOptions): Promise<string> {
  const messages = [...options.messages]
  const numeric = new Set(['offset', 'limit', 'maxDepth', 'maxHits', 'timeoutMs'])
  const tools = options.tools.map(spec => ({ type: 'function', function: {
    name: spec.name, description: spec.description,
    parameters: { type: 'object', properties: Object.fromEntries(spec.params.map(p => [p.key, { type: numeric.has(p.key) ? 'number' : 'string', description: p.label }])), required: spec.params.filter(p => p.required).map(p => p.key), additionalProperties: false }
  } }))
  let continuationRequested = false
  let stream = options.stream ?? false
  for (let round = 0; round < 16; round++) {
    options.signal.throwIfAborted()
    const request = () => appFetch(options.url, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) },
      body: JSON.stringify({ model: options.model, messages, tools, tool_choice: 'auto', parallel_tool_calls: false, stream, max_tokens: options.maxTokens, temperature: options.temperature })
    })
    let response = await request()
    if (!response.ok && stream && [400, 422, 501].includes(response.status)) {
      const detail = await response.text()
      if (!/stream/i.test(detail)) throw new Error(`模型工具调用返回 ${response.status}：${detail.slice(0, 300)}`)
      stream = false
      response = await request()
    }
    if (!response.ok) throw new Error(`模型工具调用返回 ${response.status}：${(await response.text()).slice(0, 300)}`)
    const message = await readCompletion(response, options)
    options.signal.throwIfAborted()
    if (!message.tool_calls?.length) {
      const text = String(message.content || '')
      const onlyPromise = text.length < 220 && /让我.{0,10}(看看|查看|读取|检查)|我(先|来|会|将).{0,14}(查看|读取|检查|搜索)|稍等|马上.{0,6}(查看|读取|检查)/.test(text) && !/失败|无法|不能|未连接|错误/.test(text)
      if (onlyPromise && !continuationRequested) {
        continuationRequested = true
        messages.push({ role: 'assistant', content: text }, { role: 'system', content: '继续完成当前请求，不要停在行动预告。必要时立即调用工具；已有附件内容则直接分析。现在返回实际结果，失败则说明原因，不需要用户再发消息。' })
        continue
      }
      if (onlyPromise) return '这次文件任务尚未完成：模型没有执行必要的读取操作或提供分析结果，未将行动预告当作完成。'
      return text
    }
    if (message.tool_calls.length > 8) throw new Error('单轮工具调用过多，已停止')
    messages.push(message)
    for (const call of message.tool_calls) {
      options.signal.throwIfAborted()
      let content: string
      try {
        if (!options.tools.some(t => t.name === call.function.name)) throw new Error('不支持该工具')
        const params = JSON.parse(call.function.arguments || '{}')
        if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('工具参数必须是对象')
        content = await options.execute(call.function.name, params)
      } catch (error) {
        options.signal.throwIfAborted()
        content = `工具失败，未完成请求：${error instanceof Error ? error.message : String(error)}`
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, 40000) })
    }
  }
  throw new Error('已达到 16 轮工具调用上限，请缩小任务范围后继续')
}
