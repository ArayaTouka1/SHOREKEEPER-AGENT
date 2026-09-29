/**
 *
 *
 *
 *
 * ───────────────────────────────────────────────────────────────
 * ───────────────────────────────────────────────────────────────
 *  {
 *    ]
 *  }
 *
 * ───────────────────────────────────────────────────────────────
 * ───────────────────────────────────────────────────────────────
 *
 *    - require / module / exports / __dirname / __filename
 *
 */

import { app, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync, cpSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, extname } from 'node:path'
import * as vm from 'node:vm'
import { JsonStore } from './store'
import type {
  BrokenPlugin,
  PluginCommandInfo,
  PluginCommandSpec,
  PluginImportResult,
  PluginInfo,
  PluginInvokeResult,
  PluginListResult,
  PluginManifest,
  PluginState
} from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const LOAD_TIMEOUT_MS = 3000
const INVOKE_TIMEOUT_MS = 5000
const MAX_RESULT_DEPTH = 8
const MAX_LOGS = 50
const MAX_LOG_LEN = 400

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CMD_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/

const ICON_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}
const MAX_ICON_BYTES = 2 * 1024 * 1024

export const MANIFEST_FILE = 'plugin.json'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let cachedBuiltinDir: string | null = null

/**
 */
export function builtinPluginDir(): string {
  if (cachedBuiltinDir) return cachedBuiltinDir
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'plugins') : '',
    join(app.getAppPath(), 'resources', 'plugins'),
    join(app.getAppPath(), '..', 'resources', 'plugins'),
    join(__dirname, '..', '..', 'resources', 'plugins')
  ]
  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      cachedBuiltinDir = dir
      return dir
    }
  }
  cachedBuiltinDir = ''
  return cachedBuiltinDir
}

export function userPluginDir(): string {
  const dir = join(app.getPath('userData'), 'plugins')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type ManifestCheck = { ok: true; manifest: PluginManifest } | { ok: false; error: string }

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/**
 */
export function validateManifest(raw: unknown): ManifestCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'plugin.json 必须是一个 JSON 对象' }
  }
  const o = raw as Record<string, unknown>

  const id = asString(o.id).trim()
  if (!id) return { ok: false, error: '缺少必填字段 id' }
  if (!ID_RE.test(id)) return { ok: false, error: `id 不合法：${id}（只允许字母数字与 . _ -，且以字母数字开头）` }

  const name = asString(o.name).trim()
  if (!name) return { ok: false, error: '缺少必填字段 name' }

  const main = asString(o.main).trim()
  if (!main) return { ok: false, error: '缺少必填字段 main（入口脚本，如 index.js）' }
  if (isAbsolute(main) || /^[A-Za-z]:/.test(main)) return { ok: false, error: `main 必须是相对路径：${main}` }
  if (main.split(/[\\/]/).includes('..')) return { ok: false, error: `main 不能跳出插件目录：${main}` }
  const lower = main.toLowerCase()
  if (!lower.endsWith('.js') && !lower.endsWith('.cjs')) {
    return { ok: false, error: `main 只支持 .js / .cjs（沙箱按 CommonJS 风格脚本执行）：${main}` }
  }

  let icon: string | null = null
  const rawIcon = o.icon
  if (rawIcon !== undefined && rawIcon !== null && rawIcon !== '') {
    if (typeof rawIcon !== 'string') return { ok: false, error: 'icon 必须是字符串（相对插件目录的图片路径）' }
    const iconPath = rawIcon.trim()
    if (!iconPath) {
      icon = null
    } else {
      if (isAbsolute(iconPath) || /^[A-Za-z]:/.test(iconPath)) return { ok: false, error: `icon 必须是相对路径：${iconPath}` }
      if (iconPath.split(/[\\/]/).includes('..')) return { ok: false, error: `icon 不能跳出插件目录：${iconPath}` }
      if (!ICON_MIME[extname(iconPath).toLowerCase()]) {
        return { ok: false, error: `icon 只支持图片格式（png / jpg / jpeg / webp / gif / svg / bmp / ico / avif）：${iconPath}` }
      }
      icon = iconPath
    }
  }

  const commands: PluginCommandSpec[] = []
  const rawCmds = o.commands
  if (rawCmds !== undefined) {
    if (!Array.isArray(rawCmds)) return { ok: false, error: 'commands 必须是数组' }
    for (let i = 0; i < rawCmds.length; i++) {
      const item = rawCmds[i]
      const cname = typeof item === 'string' ? item.trim() : asString((item as Record<string, unknown>)?.name).trim()
      if (!CMD_RE.test(cname)) return { ok: false, error: `commands[${i}].name 不合法：${String(cname)}` }
      const src = typeof item === 'string' ? {} : ((item ?? {}) as Record<string, unknown>)
      commands.push({
        name: cname,
        label: asString(src.label).trim() || cname,
        description: asString(src.description).trim()
      })
    }
    const dup = commands.map((c) => c.name).find((n, i, arr) => arr.indexOf(n) !== i)
    if (dup) return { ok: false, error: `commands 里有重复的命令名：${dup}` }
  }

  return {
    ok: true,
    manifest: {
      id,
      name,
      version: asString(o.version).trim() || '1.0.0',
      author: asString(o.author).trim(),
      description: asString(o.description).trim(),
      main,
      icon,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
      commands
    }
  }
}

/**
 */
export function pluginIconDataUrl(manifest: PluginManifest, dir: string): string | null {
  if (!manifest.icon) return null
  const target = resolve(dir, manifest.icon)
  const rel = relative(dir, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null

  const mime = ICON_MIME[extname(target).toLowerCase()]
  if (!mime) return null

  try {
    if (!existsSync(target) || !statSync(target).isFile()) return null
    if (statSync(target).size > MAX_ICON_BYTES) return null
    const buf = readFileSync(target)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function tagOf(v: unknown): string {
  return Object.prototype.toString.call(v)
}

export function toPlain(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') return Number.isFinite(value as number) ? value : String(value)
  if (t === 'undefined') return null
  if (t === 'bigint' || t === 'symbol') return String(value)
  if (t === 'function') return '[Function]'
  if (depth >= MAX_RESULT_DEPTH) return '[深度超限]'

  const tag = tagOf(value)
  if (tag === '[object Date]') {
    const d = value as Date
    try {
      return d.toISOString()
    } catch {
      return String(value)
    }
  }
  if (tag === '[object RegExp]') return String(value)
  if (tag === '[object Error]') {
    const e = value as Error
    return { name: String(e.name), message: String(e.message) }
  }
  if (tag === '[object Promise]') return '[Promise]'

  if (Array.isArray(value)) {
    return (value as unknown[]).slice(0, 500).map((v) => toPlain(v, depth + 1))
  }
  if (tag === '[object Map]') {
    const out: Record<string, unknown> = {}
    let i = 0
    ;(value as Map<unknown, unknown>).forEach((v, k) => {
      if (i++ < 200) out[String(k)] = toPlain(v, depth + 1)
    })
    return out
  }
  if (tag === '[object Set]') {
    return [...(value as Set<unknown>)].slice(0, 500).map((v) => toPlain(v, depth + 1))
  }

  if (t === 'object') {
    const out: Record<string, unknown> = {}
    let keys: string[] = []
    try {
      keys = Object.keys(value as object)
    } catch {
      return String(value)
    }
    for (const k of keys.slice(0, 200)) {
      try {
        out[k] = toPlain((value as Record<string, unknown>)[k], depth + 1)
      } catch {
        out[k] = '[不可读]'
      }
    }
    return out
  }
  return String(value)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const pluginStateStore = new JsonStore<PluginState>('plugins', () => ({ enabled: {} }))

function readEnabledMap(): Record<string, boolean> {
  const s = pluginStateStore.read()
  if (!s || typeof s !== 'object' || !s.enabled || typeof s.enabled !== 'object') return {}
  return s.enabled
}

export function explicitEnabled(id: string): boolean | undefined {
  const v = readEnabledMap()[id]
  return typeof v === 'boolean' ? v : undefined
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

type PluginFn = (args: unknown) => unknown

interface LoadedPlugin {
  manifest: PluginManifest
  dir: string
  builtin: boolean
  enabled: boolean
  loaded: boolean
  error: string | null
  commands: Map<string, PluginFn>
  commandList: PluginCommandInfo[]
  missing: string[]
  logs: string[]
}

interface ScanResult {
  plugins: LoadedPlugin[]
  broken: BrokenPlugin[]
}

let cache: ScanResult | null = null

export function refreshPlugins(): void {
  cache = null
}

function scanDir(dir: string, builtin: boolean, out: LoadedPlugin[], broken: BrokenPlugin[]): void {
  if (!dir || !existsSync(dir)) return
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch (err) {
    broken.push({ dir, error: `目录不可读：${err instanceof Error ? err.message : String(err)}` })
    return
  }

  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }

    const manifestPath = join(full, MANIFEST_FILE)
    if (!existsSync(manifestPath)) {
      broken.push({ dir: full, error: `缺少 ${MANIFEST_FILE}` })
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      broken.push({ dir: full, error: `${MANIFEST_FILE} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}` })
      continue
    }

    const check = validateManifest(parsed)
    if (!check.ok) {
      broken.push({ dir: full, error: `清单校验失败：${check.error}` })
      continue
    }

    const dupIndex = out.findIndex((p) => p.manifest.id === check.manifest.id)
    if (dupIndex >= 0) {
      if (builtin) continue // 已有用户版本，跳过内置版本
      out.splice(dupIndex, 1)
    }

    out.push(loadPlugin(check.manifest, full, builtin))
  }
}

function loadPlugin(manifest: PluginManifest, dir: string, builtin: boolean): LoadedPlugin {
  const explicit = explicitEnabled(manifest.id)
  const enabled = explicit === undefined ? manifest.enabled : explicit
  const logs: string[] = []
  const commands = new Map<string, PluginFn>()

  const record = (message: unknown): void => {
    const text = String(message).slice(0, MAX_LOG_LEN)
    logs.push(text)
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
  }

  const plugin: LoadedPlugin = {
    manifest,
    dir,
    builtin,
    enabled,
    loaded: false,
    error: null,
    commands,
    commandList: manifest.commands.map((c) => ({ ...c, registered: false })),
    missing: [],
    logs
  }

  if (!enabled) {
    plugin.missing = manifest.commands.map((c) => c.name)
    return plugin
  }

  const mainPath = resolve(dir, manifest.main)
  const rel = relative(dir, mainPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    plugin.error = `入口脚本越出插件目录：${manifest.main}`
    return plugin
  }
  if (!existsSync(mainPath)) {
    plugin.error = `入口脚本不存在：${manifest.main}`
    return plugin
  }

  let code = ''
  try {
    code = readFileSync(mainPath, 'utf-8')
  } catch (err) {
    plugin.error = `入口脚本不可读：${err instanceof Error ? err.message : String(err)}`
    return plugin
  }

  const sandbox: Record<string, unknown> = Object.create(null)
  sandbox.registerCommand = (name: unknown, fn: unknown): boolean => {
    const key = typeof name === 'string' ? name.trim() : ''
    if (!CMD_RE.test(key)) {
      record(`[宿主] registerCommand 名称不合法，已忽略：${String(name)}`)
      return false
    }
    if (typeof fn !== 'function') {
      record(`[宿主] registerCommand 缺少函数实现，已忽略：${key}`)
      return false
    }
    commands.set(key, fn as PluginFn)
    return true
  }
  sandbox.log = (...parts: unknown[]): void => {
    record(parts.map((p) => (typeof p === 'string' ? p : safeStringify(p))).join(' '))
  }
  sandbox.host = Object.freeze({
    id: manifest.id,
    pluginName: manifest.name,
    version: manifest.version,
    dir,
    appVersion: app.getVersion(),
    now: () => Date.now()
  })

  const context = vm.createContext(sandbox, {
    name: `plugin:${manifest.id}`,
    codeGeneration: { strings: false, wasm: false }
  })

  try {
    vm.runInContext(code, context, { filename: mainPath, timeout: LOAD_TIMEOUT_MS, displayErrors: true })
    plugin.loaded = true
  } catch (err) {
    plugin.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    plugin.loaded = false
    return plugin
  }

  const listed = new Map<string, PluginCommandInfo>(
    manifest.commands.map((c) => [c.name, { ...c, registered: false }])
  )
  for (const name of commands.keys()) {
    const declared = listed.get(name)
    listed.set(name, declared ? { ...declared, registered: true } : { name, label: name, description: '（运行时注册）', registered: true })
  }
  plugin.commandList = [...listed.values()]
  plugin.missing = plugin.commandList.filter((c) => !c.registered).map((c) => c.name)
  return plugin
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function scan(): ScanResult {
  const out: LoadedPlugin[] = []
  const broken: BrokenPlugin[] = []
  const builtin = builtinPluginDir()
  const user = userPluginDir()
  if (builtin && resolve(builtin) !== resolve(user)) scanDir(builtin, true, out, broken)
  scanDir(user, false, out, broken)
  out.sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.manifest.name.localeCompare(b.manifest.name))
  return { plugins: out, broken }
}

function ensureScan(): ScanResult {
  if (!cache) cache = scan()
  return cache
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function toInfo(p: LoadedPlugin): PluginInfo {
  return {
    manifest: { ...p.manifest, commands: p.manifest.commands.map((c) => ({ ...c })) },
    dir: p.dir,
    builtin: p.builtin,
    enabled: p.enabled,
    loaded: p.loaded,
    error: p.error,
    commands: p.commandList.map((c) => ({ ...c })),
    missing: [...p.missing],
    logs: [...p.logs],
    iconUrl: pluginIconDataUrl(p.manifest, p.dir)
  }
}

export function listPlugins(): PluginListResult {
  const { plugins, broken } = ensureScan()
  return {
    plugins: plugins.map(toInfo),
    broken: broken.map((b) => ({ ...b })),
    dir: userPluginDir()
  }
}

export function getPlugin(id: string): PluginInfo | null {
  const found = ensureScan().plugins.find((p) => p.manifest.id === id)
  return found ? toInfo(found) : null
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function setPluginEnabled(id: string, enabled: boolean): PluginInfo | null {
  const found = ensureScan().plugins.find((p) => p.manifest.id === id)
  if (!found) throw new Error(`插件不存在：${id}`)
  pluginStateStore.update((draft) => {
    if (!draft.enabled || typeof draft.enabled !== 'object') draft.enabled = {}
    draft.enabled[id] = enabled
  })
  refreshPlugins()
  return getPlugin(id)
}

export function removePlugin(id: string): PluginListResult {
  const found = ensureScan().plugins.find((p) => p.manifest.id === id)
  if (!found) throw new Error(`插件不存在：${id}`)
  if (found.builtin) throw new Error(`内置插件不能删除，只能停用：${found.manifest.name}`)

  const userRoot = resolve(userPluginDir())
  const target = resolve(found.dir)
  const rel = relative(userRoot, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`拒绝删除用户插件目录之外的路径：${target}`)
  }
  rmSync(target, { recursive: true, force: true })

  pluginStateStore.update((draft) => {
    if (draft.enabled && typeof draft.enabled === 'object') delete draft.enabled[id]
  })
  refreshPlugins()
  return listPlugins()
}

export function importPluginFolder(sourceDir: string): PluginImportResult {
  const src = resolve(String(sourceDir ?? ''))
  if (!src || !existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`不是一个文件夹：${sourceDir}`)
  }
  const manifestPath = join(src, MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    throw new Error(`该文件夹里没有 ${MANIFEST_FILE}，不是合法的插件目录`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} 解析失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const check = validateManifest(parsed)
  if (!check.ok) throw new Error(`清单校验失败：${check.error}`)

  const dest = join(userPluginDir(), check.manifest.id)
  if (resolve(dest) === src) throw new Error('插件已经在该目录里了，不需要重复导入')

  const replaced = existsSync(dest)
  if (replaced) rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true, force: true, errorOnExist: false })

  refreshPlugins()
  const next = getPlugin(check.manifest.id)
  return { plugin: next, replaced, list: listPlugins() }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 执行超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolvePromise(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 */
export async function invokePluginCommand(
  pluginId: string,
  commandName: string,
  args?: unknown
): Promise<PluginInvokeResult> {
  const started = Date.now()
  const done = (ok: boolean, result: unknown, error: string | null): PluginInvokeResult => ({
    ok,
    result,
    error,
    ms: Date.now() - started
  })

  try {
    const plugin = ensureScan().plugins.find((p) => p.manifest.id === pluginId)
    if (!plugin) return done(false, null, `插件不存在：${pluginId}`)
    if (!plugin.enabled) return done(false, null, `插件已停用：${manifestLabel(plugin)}`)
    if (!plugin.loaded) return done(false, null, `插件未成功加载：${plugin.error ?? '未知原因'}`)

    const fn = plugin.commands.get(commandName)
    if (!fn) {
      const known = [...plugin.commands.keys()]
      return done(false, null, `插件「${plugin.manifest.name}」没有注册命令 ${commandName}${known.length ? `（可用：${known.join(', ')}）` : ''}`)
    }

    const payload = toPlain(args === undefined ? {} : args)
    const value = await withTimeout(Promise.resolve(fn(payload)), INVOKE_TIMEOUT_MS, `命令 ${pluginId}.${commandName}`)
    return done(true, toPlain(value), null)
  } catch (err) {
    return done(false, null, err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  }
}

function manifestLabel(p: LoadedPlugin): string {
  return p.manifest.name || p.manifest.id
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export async function revealPluginFolder(id?: string): Promise<string> {
  let target = userPluginDir()
  if (id) {
    const plugin = ensureScan().plugins.find((p) => p.manifest.id === id)
    if (plugin) target = plugin.dir
  }
  if (!existsSync(target)) mkdirSync(target, { recursive: true })
  const err = await shell.openPath(target)
  if (err) throw new Error(`打开目录失败：${err}`)
  return target
}
