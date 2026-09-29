/**
 *
 *
 *     → isWindowsReservedName()
 *
 *     → hasWindowsIllegalChars()
 *
 *
 *     → probeFile()
 *
 *
 *     → renameOrCopy()
 *
 */

import { existsSync, mkdirSync, statSync, accessSync, copyFileSync, renameSync, rmSync, realpathSync, writeFileSync, constants } from 'node:fs'
import { isAbsolute, resolve, relative, dirname, sep, parse, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { isPathInside, getMachinePermission } from './permission'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const MAX_PATH = 260
const MAX_PATH_SAFE = MAX_PATH - 40

/**
 */
const WIN_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

const WIN_ILLEGAL = /[<>:"|?*]/

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function isWindowsReservedName(name: string): boolean {
  if (!name) return false
  const base = parse(name).name.toUpperCase()
  return WIN_RESERVED.has(base)
}

export function hasWindowsIllegalChars(name: string): boolean {
  if (!name) return false
  if (WIN_ILLEGAL.test(name)) return true
  if (name.endsWith('.') || name.endsWith(' ')) return true
  return false
}

/**
 */
function validateNameForWrite(full: string): void {
  if (process.platform !== 'win32') return
  const parts = full.split(/[\\/]/).filter(Boolean)
  for (const part of parts) {
    if (/^[a-zA-Z]:$/.test(part)) continue
    if (isWindowsReservedName(part)) {
      const base = parse(part).name.toUpperCase()
      throw new Error(
        `「${part}」是 Windows 保留设备名（${base}），不能用作文件名或目录名。` +
        `这类名字不会真的写进磁盘，读取时还会把进程卡住。请换一个名字，比如 files/${part} 或 ${base.toLowerCase()}-1。`
      )
    }
    if (hasWindowsIllegalChars(part)) {
      throw new Error(
        `文件名「${part}」含有 Windows 不允许的字符（< > : " | ? * 之一），或结尾是点/空格。` +
        `Windows 会静默改写这类名字，导致写进去的和读出来的对不上。请改掉这些字符。`
      )
    }
  }
}

function validatePathLength(full: string, label: string): void {
  if (process.platform !== 'win32') return
  if (full.length > MAX_PATH_SAFE) {
    throw new Error(
      `${label}路径过长（${full.length} 字符，Windows 上限约 ${MAX_PATH}）。` +
      `请减少目录层级、把工作区改到更短的路径（例如 C:\\work），或在系统里启用长路径支持。`
    )
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface FileProbe {
  exists: boolean
  kind: 'dir' | 'file' | 'none'
  writable: boolean
  reason: string
  size?: number
}

const ERR_TEXT: Record<string, string> = {
  EACCES: '没有访问权限（文件被设为只读，或当前用户无权访问）',
  EPERM: '操作被拒绝（文件正被其它程序占用，或没有写权限）',
  EBUSY: '文件正被其它程序占用（比如 Excel / Word / 播放器打开了它），请先关闭再试',
  EISDIR: '这是一个目录，不是文件',
  ENOTDIR: '路径中的某一级其实是文件，不能当成目录',
  ENOENT: '路径不存在',
  ENAMETOOLONG: '路径过长',
  EXDEV: '跨磁盘移动不被支持（会退化成复制）',
  ENOTEMPTY: '目录非空，无法直接删除',
  EEXIST: '目标已存在'
}

export function explainFsError(code: string | undefined, fallback: string): string {
  if (!code) return fallback
  return ERR_TEXT[code] ?? fallback
}

/**
 *
 */
export function probeFile(full: string, forWrite: boolean): FileProbe {
  let st: ReturnType<typeof statSync> | null = null
  try {
    st = statSync(full)
  } catch {
    st = null
  }

  if (!st) {
    if (!forWrite) {
      return { exists: false, kind: 'none', writable: false, reason: '文件不存在' }
    }
    const parent = dirname(full)
    try {
      accessSync(parent, constants.W_OK)
      return { exists: false, kind: 'none', writable: true, reason: '父目录可写，可以新建' }
    } catch (e: any) {
      return {
        exists: false,
        kind: 'none',
        writable: false,
        reason: `父目录不可写：${explainFsError(e?.code, '没有写入权限')}`
      }
    }
  }

  if (st.isDirectory()) {
    return { exists: true, kind: 'dir', writable: false, reason: '这是一个目录，请用 fs_list 查看，或用具体文件名写入' }
  }

  const probe: FileProbe = { exists: true, kind: 'file', writable: true, reason: '可写', size: st.size }
  if (forWrite) {
    try {
      accessSync(full, constants.W_OK)
    } catch (e: any) {
      probe.writable = false
      probe.reason = explainFsError(e?.code, '没有写入权限')
    }
  }
  return probe
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface SafePathOptions {
  mustExist?: boolean
  forWrite?: boolean
  allowSymlinkEscape?: boolean
  /**
   */
  readOnly?: boolean
}


/**
 *
 */
export function resolveSafePath(p: string, opts: SafePathOptions = {}): string {
  let input = String(p ?? '').trim().replace(/^["'“](.*)["'”]$/, '$1')
  if (/^file:\/\//i.test(input)) input = fileURLToPath(input)
  if (/^~([\\/]|$)/.test(input)) input = app.getPath('home') + input.slice(1)
  input = input.replace(/%([^%]+)%/g, (match, key) => process.env[key] ?? match)
  if (/^[a-z]:$/i.test(input)) input += '\\'
  if (!input) throw new Error('路径不能为空')

  if (input.includes('\0')) throw new Error('路径中含有非法字符（NUL）')

  const root = getWorkspaceDir()
  const full = isAbsolute(input) ? resolve(input) : resolve(root, input)
  // Validate device names for reads too: CON can block a process indefinitely.
  if (process.platform === 'win32') validateNameForWrite(full)
  const actual = canonicalFsPath(full)
  const actualRoot = canonicalFsPath(root)
  if (opts.forWrite) {
    const tier = getMachinePermission()
    if (tier === 'view') throw new Error('当前仅可查看，不能写入文件')
    if (tier !== 'full' && !isPathInside(actualRoot, actual)) {
      throw new Error(`写入路径超出工作区：${actual}。请选择对应工作区或切换为完全权限。`)
    }
    validatePathLength(full, '写入')
  }
  if (opts.mustExist && !existsSync(actual)) throw new Error(`路径不存在：${actual}；当前工作区：${root}`)
  return actual

}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ *
 */

let workspaceRoot = ''

export function setWorkspaceRoot(p: string): void {
  workspaceRoot = p ? resolve(p) : ''
}

export function getWorkspaceRoot(): string {
  if (workspaceRoot) return workspaceRoot
  try {
    const p = app.getPath('userData')
    return resolve(p, 'workspace')
  } catch {
    return resolve(process.cwd(), 'workspace')
  }
}

function getWorkspaceDir(): string {
  return getWorkspaceRoot()
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function ensureParentDir(full: string): boolean {
  const parent = dirname(full)
  if (existsSync(parent)) return false
  resolveSafePath(full, { forWrite: true })
  mkdirSync(parent, { recursive: true })
  return true
}

/** Resolve the nearest existing ancestor, including junctions for new files. */
export function canonicalFsPath(input: string): string {
  let parent = resolve(input)
  const missing: string[] = []
  while (!existsSync(parent)) {
    const next = dirname(parent)
    if (next === parent) break
    missing.unshift(basename(parent))
    parent = next
  }
  return join(realpathSync(parent), ...missing)
}

/**
 */
export function atomicWrite(full: string, content: string | Buffer): void {
  const tmp = `${full}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    writeFileSync(tmp, content, { encoding: 'utf-8' })
    renameSync(tmp, full)
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw e
  }
}

/**
 */
export function renameOrCopy(src: string, dst: string): { copied: boolean } {
  try {
    renameSync(src, dst)
    return { copied: false }
  } catch (e: any) {
    if (e?.code !== 'EXDEV') throw e
    copyFileSync(src, dst)
    rmSync(src, { force: true })
    return { copied: true }
  }
}

export function displayPath(full: string): string {
  try {
    const rel = relative(getWorkspaceDir(), full)
    return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : full
  } catch {
    return full
  }
}
