/**
 *
 *
 *
 *
 *
 */

import type {
  AgentToolSpec,
  PermissionDecision
} from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type ToolCategory = AgentToolSpec['category']

export interface ToolParam {
  key: string
  label: string
  required?: boolean
  allowEmpty?: boolean
  description?: string
  example?: string
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  enum?: string[]
  default?: unknown
}

export interface ToolRunContext {
  signal?: AbortSignal
  name: string
  args: Record<string, unknown>
  workspace: string
  tier: string
  decision: PermissionDecision
}

export interface ToolOutcome<T = unknown> {
  result: T
  summary: string
  context: string
  presentation?: ToolPresentation
}

export type ToolPresentation =
  | { kind: 'text' }
  | { kind: 'diff'; path: string; added: number; removed: number }
  | { kind: 'terminal'; command: string; exitCode: number }
  | { kind: 'files'; paths: string[] }
  | { kind: 'search'; count: number; pattern: string }

export interface ToolDefinition {
  name: string
  displayName: string
  actionLabel: string
  description: string
  category: ToolCategory
  permission: AgentToolSpec['permission']
  params: ToolParam[]
  /**
   */
  execute(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolOutcome> | ToolOutcome
  /**
   */
  validate?(args: Record<string, unknown>): void
  /**
   */
  isConcurrencySafe?(args: Record<string, unknown>): boolean
  hidden?: boolean
}

/* ------------------------------------------------------------------ *
 *  defineTool
 * ------------------------------------------------------------------ */

/**
 *
 *
 *   export default defineTool({
 *     name: 'fs_read',
 *     ...,
 *     execute: async (args, ctx) => ({
 *       result: { ... },
 *     })
 *   })
 */
export function defineTool(def: ToolDefinition): ToolDefinition {
  if (!def.name || !/^[a-z][a-z0-9_]*$/.test(def.name)) {
    throw new Error(`工具名不合法：${def.name}（要求小写字母+下划线）`)
  }
  if (!def.execute) throw new Error(`工具 ${def.name} 缺少 execute`)
  return def
}

export function toParamSpecs(params: ToolParam[]): AgentToolSpec['params'] {
  return params.map((p) => ({
    key: p.key,
    label: p.label,
    required: p.required === true,
    example: p.example
  }))
}

export function toAgentToolSpec(def: ToolDefinition): AgentToolSpec {
  return {
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    category: def.category,
    permission: def.permission,
    params: toParamSpecs(def.params)
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export class ToolArgsError extends Error {
  readonly toolName: string
  constructor(toolName: string, message: string) {
    super(`工具 ${toolName} 的参数有误：${message}`)
    this.name = 'ToolArgsError'
    this.toolName = toolName
  }
}

export function validateArgs(def: ToolDefinition, args: Record<string, unknown>): void {
  if (def.validate) {
    def.validate(args)
    return
  }
  for (const p of def.params) {
    const v = args[p.key]
    const missing = v === undefined || v === null || (v === '' && !p.allowEmpty)
    if (p.required && missing) {
      throw new ToolArgsError(def.name, `缺少必填参数「${p.label}」（${p.key}）`)
    }
    if (missing) continue

    const t = p.type ?? 'string'
    if (t === 'string' && typeof v !== 'string') {
      throw new ToolArgsError(def.name, `参数「${p.label}」应为字符串`)
    }
    if (t === 'number' && typeof v !== 'number' && Number.isNaN(Number(v))) {
      throw new ToolArgsError(def.name, `参数「${p.label}」应为数字`)
    }
    if (t === 'boolean' && typeof v !== 'boolean' && v !== 'true' && v !== 'false') {
      throw new ToolArgsError(def.name, `参数「${p.label}」应为布尔值`)
    }
    if (t === 'array' && !Array.isArray(v)) {
      throw new ToolArgsError(def.name, `参数「${p.label}」应为数组`)
    }
    if (p.enum && !p.enum.includes(String(v))) {
      throw new ToolArgsError(
        def.name,
        `参数「${p.label}」只能是：${p.enum.join(' / ')}（收到 ${String(v)}）`
      )
    }
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export class ToolRegistry {
  private readonly map = new Map<string, ToolDefinition>()
  private readonly order: string[] = []

  register(def: ToolDefinition): this {
    if (this.map.has(def.name)) {
      throw new Error(`工具重名：${def.name}（已经被注册过）`)
    }
    this.map.set(def.name, def)
    this.order.push(def.name)
    return this
  }

  registerAll(defs: ToolDefinition[]): this {
    for (const d of defs) this.register(d)
    return this
  }

  get(name: string): ToolDefinition | undefined {
    return this.map.get(name)
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  all(): ToolDefinition[] {
    return this.order.map((n) => this.map.get(n)!).filter(Boolean)
  }

  specs(): AgentToolSpec[] {
    return this.all().map(toAgentToolSpec)
  }

  get size(): number {
    return this.map.size
  }

  names(): string[] {
    return [...this.order]
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type ToolPhase = 'before' | 'after' | 'error'

export type ToolVerdict =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string }
  | undefined

export interface ToolBeforeEvent {
  name: string
  args: Record<string, unknown>
  phase: 'before'
}
export interface ToolAfterEvent {
  name: string
  args: Record<string, unknown>
  outcome: ToolOutcome
  durationMs: number
  phase: 'after'
}
export interface ToolErrorEvent {
  name: string
  args: Record<string, unknown>
  error: Error
  durationMs: number
  phase: 'error'
}

export type BeforeListener = (e: ToolBeforeEvent) => ToolVerdict | Promise<ToolVerdict>
export type AfterListener = (e: ToolAfterEvent) => void | Promise<void>
export type ErrorListener = (e: ToolErrorEvent) => void | Promise<void>

/**
 *
 */
export class ToolBus {
  private readonly before: BeforeListener[] = []
  private readonly after: AfterListener[] = []
  private readonly errors: ErrorListener[] = []

  onBefore(fn: BeforeListener): () => void {
    this.before.push(fn)
    return () => {
      const i = this.before.indexOf(fn)
      if (i >= 0) this.before.splice(i, 1)
    }
  }

  onAfter(fn: AfterListener): () => void {
    this.after.push(fn)
    return () => {
      const i = this.after.indexOf(fn)
      if (i >= 0) this.after.splice(i, 1)
    }
  }

  onError(fn: ErrorListener): () => void {
    this.errors.push(fn)
    return () => {
      const i = this.errors.indexOf(fn)
      if (i >= 0) this.errors.splice(i, 1)
    }
  }

  async runBefore(e: ToolBeforeEvent): Promise<ToolVerdict> {
    for (const fn of this.before) {
      const v = await fn(e)
      if (v) return v
    }
    return undefined
  }

  async emitAfter(e: ToolAfterEvent): Promise<void> {
    for (const fn of this.after) {
      try {
        await fn(e)
      } catch (err) {
        console.warn('[toolBus] after 监听器抛错：', err)
      }
    }
  }

  async emitError(e: ToolErrorEvent): Promise<void> {
    for (const fn of this.errors) {
      try {
        await fn(e)
      } catch (err) {
        console.warn('[toolBus] error 监听器抛错：', err)
      }
    }
  }

  stats(): { before: number; after: number; errors: number } {
    return { before: this.before.length, after: this.after.length, errors: this.errors.length }
  }
}

export const toolBus = new ToolBus()
