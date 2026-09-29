import type { AgentToolSpec } from '../shared/types'

export interface ToolConversationOptions {
  url: string
  apiKey: string
  model: string
  messages: any[]
  signal: AbortSignal
  maxTokens: number
  tools: AgentToolSpec[]
  execute(name: string, params: Record<string, unknown>): Promise<string>
}

export async function toolConversation(options: ToolConversationOptions): Promise<string> {
  const messages = [...options.messages]
  const numeric = new Set(['offset', 'limit', 'maxDepth', 'maxHits', 'timeoutMs'])
  const tools = options.tools.map(spec => ({ type: 'function', function: {
    name: spec.name, description: spec.description,
    parameters: { type: 'object', properties: Object.fromEntries(spec.params.map(p => [p.key, { type: numeric.has(p.key) ? 'number' : 'string', description: p.label }])), required: spec.params.filter(p => p.required).map(p => p.key), additionalProperties: false }
  } }))
  let continuationRequested = false
  for (let round = 0; round < 16; round++) {
    options.signal.throwIfAborted()
    const response = await fetch(options.url, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) },
      body: JSON.stringify({ model: options.model, messages, tools, tool_choice: 'auto', parallel_tool_calls: false, stream: false, max_tokens: options.maxTokens })
    })
    if (!response.ok) throw new Error(`模型工具调用返回 ${response.status}：${(await response.text()).slice(0, 300)}`)
    const body = await response.json() as any
    const message = body?.choices?.[0]?.message
    if (!message) throw new Error('模型没有返回有效消息')
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
      } catch (error) { content = `工具失败，未完成请求：${error instanceof Error ? error.message : String(error)}` }
      messages.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, 40000) })
    }
  }
  throw new Error('已达到 16 轮工具调用上限，请缩小任务范围后继续')
}
