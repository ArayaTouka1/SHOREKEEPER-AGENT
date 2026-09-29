/**
 *
 *
 */

import type { IpcMain } from 'electron'
import { CH } from '../shared/channels'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface FeatureContext {
  handle(channel: string, fn: (...args: never[]) => unknown): void
  getWindow(): { webContents: { send(channel: string, ...args: unknown[]): void } } | null
  getSetting<T>(path: string): T | undefined
  emit(channel: string, ...args: unknown[]): void
}

export interface Feature {
  id: string
  label: string
  description: string
  requires?: string[]
  defaultEnabled?: boolean
  register(ctx: FeatureContext): void | Promise<void>
}

export interface BootReport {
  loaded: string[]
  disabled: string[]
  skipped: Array<{ id: string; reason: string }>
  failed: Array<{ id: string; error: string }>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export async function bootFeatures(
  features: Feature[],
  ctx: FeatureContext,
  userToggles: Record<string, boolean> = {}
): Promise<BootReport> {
  const loaded: string[] = []
  const disabled: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  const failed: Array<{ id: string; error: string }> = []

  const byId = new Map(features.map((f) => [f.id, f]))

  const canLoad = (f: Feature, seen = new Set<string>()): { ok: boolean; reason?: string } => {
    if (seen.has(f.id)) return { ok: true } // 循环依赖按可加载处理，避免栈溢出
    seen.add(f.id)
    for (const dep of f.requires ?? []) {
      const d = byId.get(dep)
      if (!d) return { ok: false, reason: `依赖的能力不存在：${dep}` }
      if (userToggles[dep] === false || (userToggles[dep] === undefined && d.defaultEnabled === false)) {
        return { ok: false, reason: `依赖的能力被关闭：${dep}` }
      }
      const sub = canLoad(d, seen)
      if (!sub.ok) return { ok: false, reason: `${dep} → ${sub.reason}` }
    }
    return { ok: true }
  }

  for (const f of features) {
    const enabled = userToggles[f.id] ?? f.defaultEnabled !== false
    if (!enabled) {
      disabled.push(f.id)
      continue
    }

    const dep = canLoad(f)
    if (!dep.ok) {
      skipped.push({ id: f.id, reason: dep.reason ?? '依赖不满足' })
      continue
    }

    try {
      await f.register(ctx)
      loaded.push(f.id)
    } catch (e) {
      failed.push({ id: f.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { loaded, disabled, skipped, failed }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function formatBootReport(report: BootReport): string[] {
  const out: string[] = []
  out.push(`[装配] 已装载 ${report.loaded.length} 个能力`)
  if (report.disabled.length) out.push(`[装配] 已关闭：${report.disabled.join('、')}`)
  for (const s of report.skipped) out.push(`[装配] 跳过 ${s.id}：${s.reason}`)
  for (const f of report.failed) out.push(`[装配] 失败 ${f.id}：${f.error}`)
  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export function createFeatureContext(opts: {
  ipcMain: IpcMain
  getWindow: () => { webContents: { send(channel: string, ...args: unknown[]): void } } | null
  getSetting: <T>(path: string) => T | undefined
  wrapError?: (e: unknown) => string
}): FeatureContext {
  const wrap = opts.wrapError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)))

  return {
    handle(channel: string, fn: (...args: never[]) => unknown): void {
      opts.ipcMain.handle(channel, async (_e, ...args) => {
        try {
          const data = await (fn as (...a: unknown[]) => unknown)(...args)
          return { ok: true, data }
        } catch (e) {
          return { ok: false, error: wrap(e) }
        }
      })
    },
    getWindow: opts.getWindow,
    getSetting: opts.getSetting,
    emit(channel: string, ...args: unknown[]): void {
      opts.getWindow()?.webContents.send(channel, ...args)
    }
  }
}

export function isValidChannel(name: string): boolean {
  return Object.values(CH as Record<string, string>).includes(name)
}
