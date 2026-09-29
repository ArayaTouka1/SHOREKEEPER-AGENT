/**
 *
 *   dsh-tool-fs              → fs_read / fs_write / fs_list / fs_search
 *   dsh-tool-str-replace-editor → fs_edit
 *   dsh-tool-pwsh / bash     → shell_run / shell_job
 *   dsh-tool-web             → web_search / web_fetch
 *   dsh-tool-todo            → todo_write
 *   dsh-tool-ask-user        → ask_user
 *   dsh-tool-present         → present_files
 *   dsh-tool-subagent        → subagent_run
 *   dsh-tool-skill           → skill_load
 *   dsh-tool-jobs            → job_list / job_output / job_kill
 *   dsh-tool-goal            → goal_set / goal_get
 *   dsh-tool-ralph           → ralph_run
 *   dsh-tool-workflow        → workflow_run
 *
 *
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, createReadStream, realpathSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, dirname, basename, extname, resolve, relative, isAbsolute } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentToolSpec, JobInfo, JobStatus, PermissionDecision, TodoItem } from '../shared/types'
import { checkPermission, getMachinePermission, isPathInside, PERMISSION_LABELS } from './permission'
import { settingsRepo } from './settings'
import { authorizeOperation, clearApprovals, securityState } from './workspaceSecurity'
import { documentText, documentVersion, decodeText } from './documents'
import { createDocx, replaceDocx, writeSheet } from './officeWork'
import { minimatch } from 'minimatch'
import { setJobsWorkspace } from './jobsStore'
import { ToolRegistry, toolBus, validateArgs, toAgentToolSpec, type ToolRunContext } from './toolKit'
import { createFsTools } from './tools/fsTools'
import { createShellTools } from './tools/shellTools'
import { createWebTools, createTaskTools, createVisionTools } from './tools/agentTools2'
import { describeImage, visionConfigOf, isImagePath } from './vision'
import {
  resolveSafePath,
  probeFile,
  ensureParentDir,
  atomicWrite,
  renameOrCopy,
  displayPath,
  setWorkspaceRoot,
  explainFsError
} from './safeFs'

const execFileAsync = promisify(execFile)

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let workspaceRoot = ''

export function getWorkspace(): string {
  if (!workspaceRoot) {
    workspaceRoot = settingsRepo.get().agent.workspace || join(app.getPath('userData'), 'workspace')
    if (!existsSync(workspaceRoot)) mkdirSync(workspaceRoot, { recursive: true })
  }
  setWorkspaceRoot(workspaceRoot)
  return workspaceRoot
}

setJobsWorkspace(() => getWorkspace())

export function setWorkspace(p: string): string {
  const full = resolveSafePath(p, { mustExist: true, readOnly: true })
  if (!statSync(full).isDirectory()) throw new Error('工作区必须是目录')
  workspaceRoot = full
  setWorkspaceRoot(full)
  clearApprovals()
  return workspaceRoot
}

/**
 *
 */
export function resolveSafe(p: string): string {
  const tier = getMachinePermission()

  if (tier === 'full') {
    const full = isAbsolute(p) ? resolve(p) : resolve(getWorkspace(), p)
    if (isSystemPath(full)) {
      throw new Error(`拒绝访问系统目录：${p}。这些位置不属于用户数据，Agent 不应写入。`)
    }
    return full
  }

  return resolveSafePath(p, {})
}

function isSystemPath(full: string): boolean {
  const win = process.env.WINDIR ?? 'C:\\Windows'
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const norm = full.toLowerCase()
  return [win, pf, pf86].some((p) => p && (norm === p.toLowerCase() || norm.startsWith(p.toLowerCase() + '\\')))
}

/**
 *
 */
function isReadableUserPath(full: string): boolean {
  let candidates: string[] = []
  try {
    candidates = [
      app.getPath('desktop'),
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('pictures'),
      app.getPath('music'),
      app.getPath('videos'),
      app.getPath('home')
    ]
  } catch {
    return false
  }
  const norm = full.toLowerCase()
  return candidates.some((c) => {
    if (!c) return false
    const r = c.toLowerCase().replace(/[\\/]+$/, '')
    return norm === r || norm.startsWith(r + '\\') || norm.startsWith(r + '/')
  })
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export const registry = new ToolRegistry()

registry.registerAll(
  createFsTools({
    readTextFile,
    writeTextFile,
    editFile,
    listDir,
    searchFiles,
    globFiles,
    deleteFile,
    moveFile,
    copyFile,
    statPath
  })
)

registry.registerAll(createShellTools((command, timeoutMs) => runShell(command, timeoutMs)))

registry.registerAll(
  createWebTools({
    webSearch,
    webFetch,
    writeTodos,
    getTodos,
    presentFiles,
    displayNameOf: (name) => registry.get(name)?.displayName
  })
)
registry.registerAll(
  createTaskTools({
    webSearch,
    webFetch,
    writeTodos,
    getTodos,
    presentFiles,
    displayNameOf: (name) => registry.get(name)?.displayName
  })
)

registry.registerAll(
  createVisionTools({
    imageDescribe: async (path, prompt) => {
      if (!path || !existsSync(path)) {
        return { result: null, summary: '图片路径不存在', context: '图片路径不存在，无法识别。' }
      }
      if (!isImagePath(path)) {
        return { result: null, summary: '不是图片文件', context: '该路径不是支持的图片格式（png/jpg/webp/gif/bmp）。' }
      }
      try {
        const desc = await describeImage(path, visionConfigOf(settingsRepo.get().llm), prompt)
        return {
          result: { description: desc },
          summary: desc.slice(0, 120),
          context: `图片识别结果：${desc}`
        }
      } catch (error) {
        return {
          result: null,
          summary: '识别失败',
          context: `识图失败：${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
  })
)

export const AGENT_TOOLS: AgentToolSpec[] = registry.specs()

export function agentToolSpec(name: string): AgentToolSpec | undefined {
  const def = registry.get(name)
  return def ? toAgentToolSpec(def) : undefined
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export { listJobs, jobOutput, killJob, startJob } from './jobsStore'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface AgentToolResult {
  result: unknown
  summary: string
  context: string
}


/**
 */
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.js', '.ts', '.tsx', '.jsx', '.css',
  '.html', '.htm', '.yml', '.yaml', '.ini', '.log', '.csv', '.xml', '.py', '.sh',
  '.ps1', '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs', '.sql', '.toml', '.env'
])

/**
 */
const BINARY_EXT = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.mp4', '.avi', '.mov', '.mkv',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svgz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.pyd', '.sys', '.o', '.a',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.pdf', '.asar', '.pak',
  '.ttf', '.otf', '.woff', '.woff2', '.eot'
])

function isProbablyBinary(p: string): boolean {
  return BINARY_EXT.has(extname(p).toLowerCase())
}

/**
 *
 */
async function readTextFile(path: string, offset = 1, limit = 400): Promise<AgentToolResult> {
  const full = resolveSafePath(path, { mustExist: true, readOnly: true })
  const st = statSync(full)
  if (st.isDirectory()) throw new Error(`这是目录不是文件：${path}。要列目录请用 fs_list`)
  const office = /\.(pdf|docx|pptx|xlsx)$/i.test(full)
  if (!office && st.size > MAX_READ_BYTES) {
    if (isProbablyBinary(full)) throw new Error('该文件是二进制内容，不能按文本读取')
    const input = createReadStream(full, { encoding: 'utf8' })
    const reader = createInterface({ input, crlfDelay: Infinity })
    const lines: string[] = []
    let current = 0
    const end = Math.max(1, offset) + Math.min(2000, Math.max(1, limit)) - 1
    try {
      for await (const line of reader) {
        current++
        if (line.includes('\0')) throw new Error('该文件是二进制内容或 UTF-16，请使用文档预览打开')
        if (current >= offset) lines.push(`${current}\t${line.slice(0, 12000)}`)
        if (current >= end || lines.join('\n').length > 40000) break
      }
    } finally { reader.close(); input.destroy() }
    const content = lines.join('\n')
    return { result: { path: full, from: offset, to: current, content }, summary: `读取 ${full} 第 ${offset}-${current} 行`, context: `${full}\n${content}\n下一段可用 offset=${current + 1} 继续读取。` }
  }

  const content = office ? await documentText(full) : decodeText(readFileSync(full))
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const all = text.split(/\r?\n/)
  const start = Math.max(0, offset - 1)
  const slice = all.slice(start, start + Math.max(1, Math.min(limit, 2000)))
  const numbered = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n')

  return {
    result: { path: displayPath(full), totalLines: all.length, from: start + 1, to: start + slice.length, content: numbered },
    summary: `读取 ${displayPath(full)}（${start + 1}-${start + slice.length} 行 / 共 ${all.length} 行）`,
    context:
      `文件 ${displayPath(full)} 第 ${start + 1}-${start + slice.length} 行（共 ${all.length} 行）：\n${numbered}` +
      (start + slice.length < all.length ? `\n（后面还有 ${all.length - start - slice.length} 行，可用 offset=${start + slice.length + 1} 继续读）` : '')
  }
}

const MAX_READ_BYTES = 4 * 1024 * 1024
const MAX_WRITE_BYTES = 8 * 1024 * 1024

/**
 */
function looksBinary(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8192))
  return head.includes(0)
}

/**
 *
 */
function writeTextFile(path: string, content: string, mode: 'w' | 'a' = 'w', expectedVersion?: string): AgentToolResult {
  const full = resolveSafePath(path, { forWrite: true })
  if (expectedVersion && (!existsSync(full) || documentVersion(readFileSync(full)) !== expectedVersion)) {
    throw new Error('文件已被其他程序修改，请重新打开后再保存，避免覆盖外部改动')
  }
  const bytes = Buffer.byteLength(content, 'utf-8')
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`要写入 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过单次上限 ${MAX_WRITE_BYTES / 1024 / 1024}MB。请拆成多次 fs_write / fs_append。`)
  }

  const created = ensureParentDir(full)
  const probe = probeFile(full, true)
  if (!probe.writable) {
    throw new Error(`不能写入 ${displayPath(full)}：${probe.reason}`)
  }
  if (probe.kind === 'dir') {
    throw new Error(`${displayPath(full)} 是目录，不能写入。请指定具体文件名。`)
  }

  const final = mode === 'a' && probe.exists ? decodeText(readFileSync(full)) + content : content
  if (Buffer.byteLength(final, 'utf-8') > MAX_WRITE_BYTES) throw new Error('追加后文件超过 8 MB 上限')
  atomicWrite(full, final)

  const lines = final.split(/\r?\n/).length
  return {
    result: { path: displayPath(full), bytes, lines, created: created || !probe.exists, mode },
    summary: `${mode === 'a' ? '已追加到' : '已写入'} ${displayPath(full)}（${lines} 行）`,
    context: `${mode === 'a' ? `已在 ${displayPath(full)} 末尾追加内容` : `已写入文件 ${displayPath(full)}`}，共 ${lines} 行、${(bytes / 1024).toFixed(1)}KB。`
  }
}

/**
 *
 */
function editFile(path: string, oldText: string, newText: string, replaceAll = false): AgentToolResult {
  const full = resolveSafePath(path, { mustExist: true, forWrite: true })
  if (!oldText) throw new Error('oldText 不能为空')
  if (oldText === newText) throw new Error('oldText 与 newText 相同，没有实际改动')

  if (statSync(full).size > MAX_WRITE_BYTES) throw new Error('文件超过编辑上限 8 MB')
  const raw = decodeText(readFileSync(full))
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const count = text.split(oldText).length - 1

  if (count === 0) {
    const lfText = text.replace(/\r\n/g, '\n')
    const lfOld = oldText.replace(/\r\n/g, '\n')
    if (lfText.split(lfOld).length - 1 > 0) {
      throw new Error(
        `在 ${displayPath(full)} 里找不到完全一致的文本，但按 LF 换行比对能匹配上 —— ` +
        `文件里是 CRLF 换行，而 oldText 用的是 LF。请把 oldText 里的换行改成 \\r\\n，或改用更短、不含换行的片段定位。`
      )
    }
    throw new Error(
      `在 ${displayPath(full)} 里找不到要替换的文本。请先用 fs_read 确认原文，` +
      `注意缩进、空格、换行必须与文件中完全一致。`
    )
  }
  if (count > 1 && !replaceAll) {
    throw new Error(
      `要替换的文本在 ${displayPath(full)} 里出现了 ${count} 次，无法唯一定位。` +
      `请多带几行上下文让片段变唯一，或传 replaceAll=true 一次性替换全部。`
    )
  }

  const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText)
  const probe = probeFile(full, true)
  if (!probe.writable) throw new Error(`不能写入 ${displayPath(full)}：${probe.reason}`)

  atomicWrite(full, next)
  return {
    result: { path: displayPath(full), replaced: replaceAll ? count : 1 },
    summary: `已编辑 ${displayPath(full)}（替换 ${replaceAll ? count : 1} 处）`,
    context: `已把 ${displayPath(full)} 中的目标文本替换为新内容${replaceAll ? `，共 ${count} 处` : ''}。`
  }
}

/**
 */
function deleteFile(path: string): AgentToolResult {
  const full = resolveSafePath(path, { mustExist: true, forWrite: true })
  const st = statSync(full)
  if (st.isDirectory()) {
    throw new Error(`${displayPath(full)} 是目录。删除目录请用 shell_run，或指定具体文件。`)
  }

  const root = getWorkspace()
  const rel = isPathInside(root, full) ? relative(root, full) : join('_external', Date.now().toString(36), basename(full))
  let dst = join(root, '.trash', rel)
  if (existsSync(dst)) dst = `${dst}.${Date.now().toString(36)}`
  ensureParentDir(dst)

  try {
    renameOrCopy(full, dst)
  } catch (e: any) {
    throw new Error(`删除失败：${explainFsError(e?.code, e?.message ?? '未知错误')}`)
  }

  return {
    result: { path: displayPath(full), trashed: displayPath(dst) },
    summary: `已把 ${displayPath(full)} 移入回收站`,
    context: `已把 ${displayPath(full)} 移动到 .trash/${rel.replace(/\\/g, '/')}，没有物理删除，随时可以恢复。`
  }
}

function moveFile(src: string, dst: string): AgentToolResult {
  const from = resolveSafePath(src, { mustExist: true, forWrite: true })
  const to = resolveSafePath(dst, { forWrite: true })
  if (from === to) throw new Error('源路径与目标路径相同')

  ensureParentDir(to)
  const probe = probeFile(to, true)
  if (!probe.writable) throw new Error(`不能写入目标位置 ${displayPath(to)}：${probe.reason}`)

  let copied = false
  try {
    const r = renameOrCopy(from, to)
    copied = r.copied
  } catch (e: any) {
    throw new Error(`移动失败：${explainFsError(e?.code, e?.message ?? '未知错误')}`)
  }

  return {
    result: { src: displayPath(from), dst: displayPath(to), copied },
    summary: `已${copied ? '复制（跨盘）并删除源' : '移动'}：${displayPath(from)} → ${displayPath(to)}`,
    context: `已把 ${displayPath(from)} ${copied ? '跨磁盘移动（复制后删源）' : '移动'}到 ${displayPath(to)}。`
  }
}

function copyFile(src: string, dst: string): AgentToolResult {
  const from = resolveSafePath(src, { mustExist: true, readOnly: true })
  const to = resolveSafePath(dst, { forWrite: true })
  if (from === to) throw new Error('源路径与目标路径相同')

  ensureParentDir(to)
  const probe = probeFile(to, true)
  if (!probe.writable) throw new Error(`不能写入目标位置 ${displayPath(to)}：${probe.reason}`)

  try {
    copyFileSync(from, to)
  } catch (e: any) {
    throw new Error(`复制失败：${explainFsError(e?.code, e?.message ?? '未知错误')}`)
  }

  return {
    result: { src: displayPath(from), dst: displayPath(to), bytes: statSync(to).size },
    summary: `已复制：${displayPath(from)} → ${displayPath(to)}`,
    context: `已把 ${displayPath(from)} 复制到 ${displayPath(to)}，原文件保留。`
  }
}

/**
 */
function statPath(path: string): AgentToolResult {
  const full = resolveSafePath(path, { mustExist: true, readOnly: true })
  const st = statSync(full)
  const probe = probeFile(full, true)
  const info = {
    path: displayPath(full),
    type: st.isDirectory() ? 'dir' : 'file',
    size: st.size,
    mtime: new Date(st.mtimeMs).toISOString(),
    ext: extname(full),
    writable: st.isDirectory() ? false : probe.writable,
    writableReason: st.isDirectory() ? '目录用 fs_list 查看' : probe.reason
  }
  return {
    result: info,
    summary: `${displayPath(full)}：${info.type === 'dir' ? '目录' : `${(st.size / 1024).toFixed(1)}KB`}${info.writable ? '' : `（不可写：${info.writableReason}）`}`,
    context:
      `${displayPath(full)}\n类型：${info.type === 'dir' ? '目录' : '文件'}\n` +
      `大小：${info.size}B\n修改时间：${info.mtime}\n` +
      (info.type === 'file' ? `可写：${info.writable ? '是' : `否（${info.writableReason}）`}` : '')
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.trash', 'dist', 'out', '.next'])

function listDir(path = '.'): AgentToolResult {
  const full = resolveSafePath(path, { mustExist: true, readOnly: true })
  if (!statSync(full).isDirectory()) throw new Error(`${displayPath(full)} 是文件不是目录。要读内容请用 fs_read`)

  const entries = readdirSync(full, { withFileTypes: true }).map((e) => {
    let size = 0
    try {
      size = e.isFile() ? statSync(join(full, e.name)).size : 0
    } catch {
      /* ignore */
    }
    let isDir = e.isDirectory()
    if (e.isSymbolicLink()) { try { isDir = statSync(join(full, e.name)).isDirectory() } catch { /* Broken link. */ } }
    return { name: e.name, path: join(full, e.name), type: isDir ? 'dir' : 'file', size }
  })
  const rel = displayPath(full)
  return {
    result: { path: full, parent: dirname(full), count: entries.length, entries },
    summary: `${rel} 下有 ${entries.length} 项`,
    context: `目录 ${rel} 内容：\n${entries.map((e) => `${e.type === 'dir' ? '[目录]' : '[文件]'} ${e.name}${e.size ? ` (${e.size}B)` : ''}`).join('\n')}`
  }
}

/**
 *
 */
function searchFiles(pattern: string, path = '.', maxHits = 60, maxDepth = 6): AgentToolResult {
  const full = resolveSafePath(path, { mustExist: true, readOnly: true })
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch (e: any) {
    throw new Error(`正则表达式「${pattern}」解析失败：${e?.message ?? '语法错误'}。注意 ? * + ( ) [ ] { } 等元字符需要转义。`)
  }

  const hits: Array<{ file: string; line: number; text: string }> = []
  let scanned = 0

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || hits.length >= maxHits) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (hits.length >= maxHits) return
      if (SKIP_DIRS.has(name)) continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(p, depth + 1)
        continue
      }
      if (st.size > 1024 * 1024) continue
      if (isProbablyBinary(p)) continue
      scanned++
      try {
        const buf = readFileSync(p)
        if (looksBinary(buf)) continue
        const lines = buf.toString('utf-8').split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push({ file: displayPath(p), line: i + 1, text: lines[i].slice(0, 200) })
            if (hits.length >= maxHits) return
          }
        }
      } catch {
      }
    }
  }

  if (statSync(full).isDirectory()) walk(full, 0)
  else {
    const buf = readFileSync(full)
    if (!looksBinary(buf)) {
      buf.toString('utf-8').split(/\r?\n/).forEach((l, i) => {
        if (re.test(l)) hits.push({ file: displayPath(full), line: i + 1, text: l.slice(0, 200) })
      })
    }
    scanned = 1
  }

  return {
    result: { pattern, count: hits.length, scanned, hits },
    summary: hits.length ? `找到 ${hits.length} 处匹配（扫描 ${scanned} 个文件）` : `没有找到匹配 ${pattern} 的内容`,
    context: hits.length
      ? `匹配 ${pattern} 的结果（${hits.length} 条）：\n${hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')}`
      : `没有找到匹配 ${pattern} 的内容（已扫描 ${scanned} 个文件）。`
  }
}

async function globFiles(pattern: string, path = '.'): Promise<AgentToolResult> {
  const root = resolveSafePath(path, { mustExist: true, readOnly: true })
  if (!statSync(root).isDirectory()) throw new Error('搜索路径必须是目录')
  const out: Array<{ path: string; size: number }> = []
  const visited = new Set<string>()
  let scanned = 0
  let truncated = false
  let skipped = 0
  const deadline = Date.now() + 5000
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 32 || out.length >= 300 || scanned >= 20000 || Date.now() > deadline) { truncated = true; return }
    let entries: string[] = []
    try {
      const real = realpathSync(dir).toLowerCase()
      if (visited.has(real)) return
      visited.add(real)
      entries = readdirSync(dir)
    } catch {
      skipped++
      return
    }
    for (const name of entries) {
      if (++scanned % 100 === 0) await new Promise<void>(done => setImmediate(done))
      if (scanned >= 20000 || out.length >= 300 || Date.now() > deadline) { truncated = true; return }
      if (SKIP_DIRS.has(name)) continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) await walk(p, depth + 1)
      else {
        const rel = relative(root, p).replace(/\\/g, '/')
        if (minimatch(rel, pattern.replace(/\\/g, '/'), { nocase: process.platform === 'win32', dot: true, matchBase: true })) out.push({ path: p, size: st.size })
      }
    }
  }

  await walk(root, 0)
  return {
    result: { pattern, count: out.length, files: out, truncated, skipped, scanned },
    summary: `匹配到 ${out.length} 个文件${truncated ? '（搜索未完成，请缩小目录范围）' : ''}`,
    context: `搜索目录：${root}\n${out.map(f => f.path).join('\n') || '未找到匹配文件'}\n${truncated ? '搜索达到时间/数量/深度上限，请缩小目录范围继续。' : ''}${skipped ? `有 ${skipped} 个目录不可访问。` : ''}`
  }
}


async function runShell(command: string, timeoutMs = 60000): Promise<AgentToolResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + command],
      { cwd: getWorkspace(), timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf-8' }
    )
    const out = (stdout || '').trim()
    const err = (stderr || '').trim()
    return {
      result: { command, exitCode: 0, stdout: out.slice(0, 20000), stderr: err.slice(0, 4000) },
      summary: `命令执行成功${out ? `，输出 ${out.split(/\r?\n/).length} 行` : ''}`,
      context: `命令 \`${command}\` 执行成功。\n${out ? '输出：\n' + out.slice(0, 6000) : '（无输出）'}${err ? '\n错误输出：\n' + err.slice(0, 2000) : ''}`
    }
  } catch (e: any) {
    const out = String(e?.stdout ?? '').trim()
    const err = String(e?.stderr ?? e?.message ?? '').trim()
    return {
      result: { command, exitCode: e?.code ?? -1, stdout: out.slice(0, 8000), stderr: err.slice(0, 4000) },
      summary: `命令失败（退出码 ${e?.code ?? -1}）`,
      context: `命令 \`${command}\` 执行失败（退出码 ${e?.code ?? -1}）。\n${out ? '输出：\n' + out.slice(0, 3000) : ''}${err ? '\n错误：\n' + err.slice(0, 2000) : ''}`
    }
  }
}


const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': WEB_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      redirect: 'follow',
      signal: ctl.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

function parseBing(html: string): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = []
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)(?=<li class="b_algo"|<\/ol>|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 10) {
    const url = m[1]
    if (!/^https?:\/\//.test(url)) continue
    const title = stripTags(m[2])
    if (!title) continue
    const block = m[3] ?? ''
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = stripTags(pMatch ? pMatch[1] : block).slice(0, 240)
    out.push({ title, url, snippet })
  }
  return out
}

function parseDdg(html: string): Array<{ title: string; url: string; snippet: string }> {
  const out: Array<{ title: string; url: string; snippet: string }> = []
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 10) {
    const rawUrl = m[1]
    const uddg = rawUrl.match(/uddg=([^&]+)/)
    const link = uddg ? decodeURIComponent(uddg[1]) : rawUrl
    out.push({ title: stripTags(m[2]), url: link, snippet: '' })
  }
  const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((x) => stripTags(x[1]))
  out.forEach((r, i) => {
    r.snippet = (snips[i] ?? '').slice(0, 240)
  })
  return out
}

/**
 *
 */
async function webSearch(query: string): Promise<AgentToolResult> {
  const q = encodeURIComponent(query)
  const sources: Array<{ name: string; url: string; parse: (h: string) => Array<{ title: string; url: string; snippet: string }> }> = [
    { name: 'bing', url: `https://www.bing.com/search?q=${q}&setlang=zh-CN`, parse: parseBing },
    { name: 'bing-cn', url: `https://cn.bing.com/search?q=${q}`, parse: parseBing },
    { name: 'duckduckgo', url: `https://html.duckduckgo.com/html/?q=${q}`, parse: parseDdg }
  ]

  const errors: string[] = []
  for (const src of sources) {
    try {
      const res = await fetchWithTimeout(src.url, 15000)
      if (!res.ok) {
        errors.push(`${src.name}: HTTP ${res.status}`)
        continue
      }
      const html = await res.text()
      const results = src.parse(html)
      if (results.length === 0) {
        errors.push(`${src.name}: 未解析到结果`)
        continue
      }
      return {
        result: { query, source: src.name, count: results.length, results },
        summary: `搜到 ${results.length} 条结果（${src.name}）`,
        context: `搜索「${query}」的结果（来源 ${src.name}）：\n${results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join('\n')}`
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${src.name}: ${msg}`)
    }
  }

  return {
    result: { query, count: 0, results: [], error: errors.join(' | ') },
    summary: `联网搜索失败（${errors[0] ?? '未知原因'}）`,
    context: `搜索「${query}」时所有搜索源都不可用：\n${errors.join('\n')}\n请检查网络连接或代理设置。`
  }
}

async function webFetch(url: string): Promise<AgentToolResult> {
  const res = await fetchWithTimeout(url, 20000)
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)
  const html = await res.text()
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '')
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const text = stripTags(body).replace(/\s+/g, ' ').trim().slice(0, 12000)

  return {
    result: { url, title, length: text.length, text },
    summary: `已抓取 ${url}${title ? `（${title}）` : ''}，${text.length} 字`,
    context: `网页 ${url}\n标题：${title}\n正文：\n${text.slice(0, 8000)}`
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}


const deliverables: Array<{ id: string; name: string; path: string; description: string; size: number; createdAt: number }> = []

export function listDeliverables(): typeof deliverables {
  return [...deliverables].sort((a, b) => b.createdAt - a.createdAt)
}

function presentFiles(paths: string[], description = ''): AgentToolResult {
  const added: string[] = []
  const skipped: string[] = []
  for (const p of paths) {
    if (!p) continue
    try {
      const full = resolveSafePath(p, { mustExist: true, readOnly: true })
      const st = statSync(full)
      deliverables.push({
        id: 'dl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: basename(full),
        path: full,
        description: description || '任务产出',
        size: st.size,
        createdAt: Date.now()
      })
      added.push(basename(full))
    } catch {
      skipped.push(p)
    }
  }
  return {
    result: { presented: added, skipped },
    summary: added.length ? `已交付 ${added.length} 个文件${skipped.length ? `，${skipped.length} 个跳过` : ''}` : '没有可交付的文件',
    context:
      (added.length ? `已把这些文件标记为交付物：${added.join('、')}。\n` : '指定的文件都不存在或不可访问。\n') +
      (skipped.length ? `以下路径被跳过（不存在或超出允许范围）：${skipped.join('、')}` : '')
  }
}


const todoState: TodoItem[] = []

export function getTodos(): TodoItem[] {
  return [...todoState]
}

function writeTodos(todos: TodoItem[]): AgentToolResult {
  todoState.length = 0
  for (const t of todos) {
    if (!t || typeof t.content !== 'string') continue
    const status: TodoItem['status'] =
      t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending'
    todoState.push({ content: t.content, status })
  }
  const done = todoState.filter((t) => t.status === 'completed').length
  return {
    result: { total: todoState.length, completed: done, todos: todoState },
    summary: `待办已更新：${done}/${todoState.length} 完成`,
    context: `当前待办：\n${todoState.map((t) => `- [${t.status === 'completed' ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.content}`).join('\n')}`
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 *
 */
function gate(name: string, params: Record<string, unknown>): PermissionDecision {
  const normalized = { ...params }
  if (name.startsWith('fs_')) for (const key of ['path', 'src', 'dst', 'from', 'to']) {
    if (typeof normalized[key] === 'string' && normalized[key]) normalized[key] = resolveSafePath(String(normalized[key]), { readOnly: true })
  }
  const decision = checkPermission(name, normalized, { workspace: resolveSafePath(getWorkspace(), { readOnly: true }) })

  if (!agentToolSpec(name)) throw new Error(`未知工具：${name}`)

  if (!decision.allowed) {
    const err = new Error(decision.reason) as Error & {
      permissionDenied?: boolean
      decision?: PermissionDecision
    }
    err.permissionDenied = true
    err.decision = decision
    throw err
  }
  return decision
}

export function previewPermission(
  name: string,
  params: Record<string, unknown> = {}
): PermissionDecision {
  return checkPermission(name, params, { workspace: getWorkspace() })
}

export function currentPermissionLabel(): string {
  return PERMISSION_LABELS[getMachinePermission()]
}

/**
 *
 */
export async function runAgentTool(
  name: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<AgentToolResult> {
  const def = registry.get(name)
  if (!def) throw new Error(`未知工具：${name}`)

  const args = params ?? {}
  validateArgs(def, args)

  const workspace = getWorkspace()
  const decision = gate(name, args)
  await authorizeOperation(workspace, decision.tier, name, args, decision.kind === 'read')
  signal?.throwIfAborted()

  if (workspace !== getWorkspace() || decision.tier !== getMachinePermission()) {
    throw new Error('审批期间工作区或权限已变更，请重试')
  }
  gate(name, args)

  const verdict = await toolBus.runBefore({ name, args, phase: 'before' })
  if (verdict?.action === 'deny') {
    const err = new Error(verdict.reason) as Error & { permissionDenied?: boolean }
    err.permissionDenied = true
    throw err
  }

  const ctx: ToolRunContext = {
    name,
    args,
    signal,
    workspace,
    tier: decision.tier,
    decision
  }

  const t0 = Date.now()
  try {
    const outcome = await def.execute(args, ctx)
    const durationMs = Date.now() - t0
    void toolBus.emitAfter({ name, args, outcome, durationMs, phase: 'after' })
    return { result: outcome.result, summary: outcome.summary, context: outcome.context }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    void toolBus.emitError({ name, args, error, durationMs: Date.now() - t0, phase: 'error' })
    throw error
  }
}
