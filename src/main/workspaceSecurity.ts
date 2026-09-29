import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { JsonStore } from './store'
import type { CommandRule, WorkspaceSecurity } from '../shared/workspace'

type Policy = { trusted: boolean; rules: CommandRule[] }
let db: JsonStore<Record<string, Policy>> | undefined
const cache = new Set<string>()
let revision = 0
const policies = (): JsonStore<Record<string, Policy>> => db ??= new JsonStore('workspace-security', () => ({}))

export function workspaceKey(root: string): string {
  let path = resolve(root)
  try { path = realpathSync(path) } catch { /* The caller validates existence. */ }
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function securityState(root: string): WorkspaceSecurity {
  const key = workspaceKey(root)
  const policy = policies().read()[key] ?? { trusted: false, rules: [] }
  return { workspace: root, ...policy, cachedApprovals: [...cache].filter(k => k.startsWith(key + '\0')).length }
}

export function clearApprovals(): void { cache.clear(); revision++ }

export function setWorkspaceTrust(root: string, trusted: boolean): WorkspaceSecurity {
  const key = workspaceKey(root)
  policies().update(all => { all[key] = { trusted, rules: all[key]?.rules ?? [] } })
  clearApprovals()
  return securityState(root)
}

export function putCommandRule(root: string, command: string, effect: 'allow' | 'deny'): WorkspaceSecurity {
  if (!command.trim() || command.length > 32000) throw new Error('命令不能为空或过长')
  if (effect !== 'allow' && effect !== 'deny') throw new Error('无效规则')
  const key = workspaceKey(root)
  policies().update(all => {
    const policy = all[key] ??= { trusted: false, rules: [] }
    policy.rules = policy.rules.filter(r => r.command !== command)
    policy.rules.push({ id: randomUUID(), command, effect, createdAt: Date.now() })
  })
  clearApprovals()
  return securityState(root)
}

export function removeCommandRule(root: string, id: string): WorkspaceSecurity {
  policies().update(all => {
    const policy = all[workspaceKey(root)]
    if (policy) policy.rules = policy.rules.filter(r => r.id !== id)
  })
  clearApprovals()
  return securityState(root)
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  return value
}

export function approvalKey(root: string, tier: string, name: string, params: Record<string, unknown>): string {
  return workspaceKey(root) + '\0' + createHash('sha256').update(JSON.stringify([tier, name, stable(params)])).digest('hex')
}
export const hasApproval = (key: string): boolean => cache.has(key)
export function rememberApproval(key: string): void {
  if (cache.size >= 500) cache.delete(cache.values().next().value!)
  cache.add(key)
}

export type ApprovalPrompt = (input: { workspace: string; name: string; params: Record<string, unknown>; command?: string }) => Promise<'once' | 'session' | 'rule' | 'deny'>
let prompt: ApprovalPrompt | undefined
export function installApprovalPrompt(handler: ApprovalPrompt): void { prompt = handler }

export async function authorizeOperation(root: string, tier: string, name: string, params: Record<string, unknown>, readOnly: boolean): Promise<void> {
  if (readOnly) return
  const policy = securityState(root)
  const command = name === 'shell_run' || name === 'shell_job' ? String(params.command ?? '') : undefined
  const rule = command !== undefined ? policy.rules.find(r => r.command === command) : undefined
  if (rule?.effect === 'deny') throw new Error('命令已被当前工作区的规则拒绝')
  if (tier === 'full') return
  if (!policy.trusted) throw new Error('当前工作区为只读。请在「对话 → 权限」中信任该工作区后再修改或执行命令。')
  if (rule?.effect === 'allow') return
  const key = approvalKey(root, tier, name, params)
  if (hasApproval(key)) return
  if (!prompt) throw new Error('审批界面尚未就绪')
  const before = revision
  const answer = await prompt({ workspace: root, name, params, command })
  if (answer === 'deny') throw new Error('用户取消了此次操作')
  if (revision !== before) throw new Error('审批期间权限或规则已变更，请重试')
  if (!securityState(root).trusted) throw new Error('工作区信任已撤销')
  if (answer === 'session') rememberApproval(key)
  if (answer === 'rule' && command !== undefined) putCommandRule(root, command, 'allow')
}
