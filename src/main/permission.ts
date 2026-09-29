/**
 *
 *
 */

import { isAbsolute, normalize, relative, resolve as resolvePath, sep } from 'node:path'
import { settingsRepo } from './settings'
import type { MachinePermission, PermissionDecision, ToolKind } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const VALID_TIERS: MachinePermission[] = ['view', 'workspace', 'full']

export const PERMISSION_LABELS: Record<MachinePermission, string> = {
  view: '仅可查看',
  workspace: '工作目录内修改',
  full: '完全权限'
}

export const PERMISSION_HINTS: Record<MachinePermission, string> = {
  view: '只能读文件、看硬件、列目录、看进程；写入与执行命令都会被拒绝',
  workspace: '在「仅可查看」基础上，可以在工作目录内写文件、删文件；工作目录外仍然拒绝',
  full: '允许工作目录外写入、执行任意命令、启动与关闭应用；不再逐次询问授权'
}

function normalizeTier(value: unknown): MachinePermission {
  return VALID_TIERS.includes(value as MachinePermission) ? (value as MachinePermission) : 'view'
}

export function getMachinePermission(): MachinePermission {
  try {
    const cfg = settingsRepo.get().agent
    return normalizeTier((cfg as { machinePermission?: unknown }).machinePermission)
  } catch {
    return 'view'
  }
}

export function setMachinePermission(p: MachinePermission): MachinePermission {
  const tier = normalizeTier(p)
  const cur = settingsRepo.get().agent
  settingsRepo.save({ agent: { ...cur, machinePermission: tier } })
  return tier
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 */
const TOOL_KIND: Record<string, ToolKind> = {
  fs_read: 'read',
  fs_roots: 'read',
  fs_list: 'read',
  fs_search: 'read',
  fs_glob: 'read',
  fs_stat: 'read',
  fs_write: 'write',
  fs_docx_create: 'write',
  fs_docx_replace: 'write',
  fs_sheet_write: 'write',
  fs_append: 'write',
  fs_edit: 'write',
  fs_delete: 'write',
  fs_move: 'write',
  fs_copy: 'write',
  shell_run: 'exec',
  shell_job: 'exec',
  web_search: 'read',
  web_fetch: 'read',
  todo_write: 'read',
  goal_set: 'read',
  goal_get: 'read',
  plan_enter: 'read',
  ask_user: 'read',
  present_files: 'read',
  subagent_run: 'exec',
  skill_load: 'read',
  workflow_run: 'exec',
  ralph_run: 'exec',
  job_list: 'read',
  job_output: 'read',
  job_kill: 'exec',

  get_hardware_status: 'read',
  launch_app: 'exec',
  list_processes: 'read',
  get_disk_usage: 'read',
  search_files: 'read',
  read_clipboard: 'read',
  write_clipboard: 'write',
  set_volume: 'write',
  take_screenshot: 'write',
  system_power: 'exec',
  open_path: 'read',

  launch_close: 'exec',
  app_close: 'exec',
  app_running_list: 'read',

  machine_permission_get: 'read',
  machine_permission_set: 'write'
}

const WRITE_HINT = /(^|[._-])(write|edit|delete|remove|rm|mkdir|create|save|patch|set|put|update|upload|copy|move|rename|append|truncate)([._-]|$)/i
const EXEC_HINT = /(^|[._-])(run|exec|execute|shell|spawn|start|launch|close|kill|stop|power|reboot|job)([._-]|$)/i

/**
 */
export function classifyTool(name: string): ToolKind {
  const key = String(name ?? '').trim()
  if (!key) return 'write'
  const known = TOOL_KIND[key]
  if (known) return known

  const lower = key.toLowerCase()
  if (EXEC_HINT.test(lower)) return 'exec'
  if (WRITE_HINT.test(lower)) return 'write'
  return 'write'
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function canonical(p: string): string {
  let out = normalize(p)
  while (out.length > 3 && (out.endsWith(sep) || out.endsWith('/'))) out = out.slice(0, -1)
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/**
 */
export function isPathInside(root: string, target: string): boolean {
  if (!root || !target) return false
  const r = canonical(resolvePath(root))
  const t = canonical(resolvePath(target))
  if (r === t) return true
  if (t.startsWith(r + sep) || t.startsWith(r + '/')) return true
  const rel = relative(r, t)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function collectPaths(params: unknown): string[] {
  if (!params || typeof params !== 'object') return []
  const obj = params as Record<string, unknown>
  const out: string[] = []

  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim())
    else if (Array.isArray(v)) v.forEach(push)
  }

  for (const key of [
    'path', 'paths', 'root', 'target', 'file', 'dir', 'directory', 'filePath',
    'src', 'source', 'from',        // 源（读端，风险较低但也要判）
    'dst', 'dest', 'destination', 'to', 'output', 'outFile'   // 目标（写端，真正的越界点）
  ]) {
    if (key in obj) push(obj[key])
  }
  if (!out.length) {
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && /^([A-Za-z]:[\\/]|\\\\|\/|\.\.)/.test(v.trim())) push(v)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface PermissionContext {
  workspace: string
}

/**
 */
export function checkPermission(
  toolName: string,
  params: Record<string, unknown> | undefined,
  ctx: PermissionContext
): PermissionDecision {
  const tier = getMachinePermission()
  const kind = classifyTool(toolName)
  const workspace = ctx?.workspace ?? ''

  if (kind === 'read') {
    return { allowed: true, reason: '读取类操作，任何档位都允许', tier, kind }
  }

  if (tier === 'full') {
    return { allowed: true, reason: '当前是完全权限，允许执行', tier, kind }
  }

  if (tier === 'view') {
    if (kind === 'exec') {
      return {
        allowed: false,
        reason: `当前是「仅可查看」档位，不能执行命令或启动应用。要跑命令请把权限切到「完全权限」。`,
        tier,
        kind
      }
    }
    return {
      allowed: false,
      reason: `当前是「仅可查看」档位，不能写入或修改文件。要改文件请把权限切到「工作目录内修改」。`,
      tier,
      kind
    }
  }

  if (kind === 'exec') {
    return {
      allowed: false,
      reason: `当前是「工作目录内修改」档位，只能在工作目录内改文件，不能执行命令或启动/关闭应用。要执行命令请把权限切到「完全权限」。`,
      tier,
      kind
    }
  }

  if (!workspace) {
    return {
      allowed: false,
      reason: `当前是「工作目录内修改」档位，但没有设置工作目录，无法确认写入范围，已拒绝。请先在设置里指定工作区，或把权限切到「完全权限」。`,
      tier,
      kind
    }
  }

  const targets = toolName === 'fs_copy' ? collectPaths({ dst: params?.dst ?? params?.to }) : collectPaths(params)
  if (!targets.length) {
    return {
      allowed: false,
      reason: `当前是「工作目录内修改」档位，这次操作没有带明确的文件路径，无法确认是否越界，已拒绝。要在工作目录外写入请把权限切到「完全权限」。`,
      tier,
      kind
    }
  }

  const outside = targets.filter((p) => !isPathInside(workspace, isAbsolute(p) ? p : resolvePath(workspace, p)))
  if (outside.length) {
    return {
      allowed: false,
      reason: `写操作超出工作目录范围（${outside[0]}），当前「工作目录内修改」档位只允许改 ${workspace} 里面的文件。要写工作目录外请把权限切到「完全权限」。`,
      tier,
      kind
    }
  }

  return { allowed: true, reason: '写操作落在工作目录内，允许执行', tier, kind }
}

/**
 */
export function assertPermission(
  toolName: string,
  params: Record<string, unknown> | undefined,
  ctx: PermissionContext
): PermissionDecision {
  const decision = checkPermission(toolName, params, ctx)
  if (!decision.allowed) {
    const err = new Error(decision.reason) as Error & { permissionDenied?: boolean; decision?: PermissionDecision }
    err.permissionDenied = true
    err.decision = decision
    throw err
  }
  return decision
}
