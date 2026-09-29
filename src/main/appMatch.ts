/**
 *
 *
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const BAD_NAME_PATTERNS: RegExp[] = [
  /卸载/,
  /uninstall/i,
  /unins\d*/i,
  /^unins/i,
  /删除/,
  /\brepair\b/i,
  /修复/,
  /^setup\b/i,
  /\bsetup\b/i,
  /^install\b/i,
  /\binstaller\b/i,
  /安装程序/,
  /反安装/,
  /^remove\b/i,
  /\bremove\b/i,
  /readme/i,
  /说明/,
  /帮助文档/,
  /help\.lnk$/i,
  /卸载程序/,
  /update\b/i,
  /^update/i,
  /^updater/i,
  /升级/,
  /更新程序/,
  /^tmp/i
]

const BAD_TARGET_PATTERNS: RegExp[] = [
  /unins\d*\.exe$/i,
  /uninstall\.exe$/i,
  /^unins/i,
  /\buninstall\b/i,
  /\bremove\b/i,
  /修复\.exe$/i,
  /repair\.exe$/i,
  /setup\.exe$/i,
  /\binstaller\.exe$/i
]

export function looksLikeUninstaller(name: string): boolean {
  return BAD_NAME_PATTERNS.some((re) => re.test(name))
}

export function targetLooksLikeUninstaller(target: string): boolean {
  const b = basename(target)
  return BAD_TARGET_PATTERNS.some((re) => re.test(b) || re.test(target))
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export function readLnkTarget(lnkPath: string): string {
  try {
    const buf = require('node:fs').readFileSync(lnkPath)

    const u16 = buf.toString('utf16le')
    const hitsU16 = u16.match(/[A-Za-z]:\\[^\u0000-\u001f"<>|*?]{4,260}?\.(exe|bat|cmd|com)/gi) ?? []

    const ascii = buf.toString('latin1')
    const hitsAscii = ascii.match(/[A-Za-z]:\\[^\u0000-\u001f"<>|*?]{4,260}?\.(exe|bat|cmd|com)/gi) ?? []

    const all = [...hitsU16, ...hitsAscii].map((s) => s.replace(/\u0000/g, '')).filter((s) => s.length > 5)

    if (!all.length) return ''

    const unins = all.find((s) => targetLooksLikeUninstaller(s))
    return unins ?? all[0]
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface LnkCandidate {
  path: string
  label: string
  dirName: string
  target: string
  score: number
}

/**
 */
export function scoreCandidate(cand: { label: string; dirName: string; target: string }, query: string): number {
  const q = query.trim().toLowerCase()
  const label = cand.label.toLowerCase()

  if (looksLikeUninstaller(cand.label)) return -1
  if (cand.target && targetLooksLikeUninstaller(cand.target)) return -1
  if (looksLikeUninstaller(cand.dirName)) return -1

  let score = 0

  if (label === q) {
    score += 1000
  } else if (label.startsWith(q)) {
    score += 600
  } else if (label.includes(q)) {
    score += 400
  } else if (cand.dirName.toLowerCase().includes(q)) {
    score += 250
  } else {
    return -1
  }

  score -= Math.min(label.length, 40) * 2

  if (/更新|升级|update|updater|助手|加速|组件|插件|服务|守护|report|报告|诊断|修复工具/.test(label)) {
    score -= 200
  }

  if (/日志|记录|查看器|viewer|文档|说明|手册|readme|doc\b|教程|帮助|终端|console|控制台|配置|设置|settings|管理工具|工具集/.test(label)) {
    score -= 150
  }

  if (/安全|中心|客户端|主程序|应用|studio|ide|editor|player/.test(label)) {
    score += 80
  }

  if (cand.target && !targetLooksLikeUninstaller(cand.target)) score += 60

  return score
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface ScanResult {
  best: LnkCandidate | null
  candidates: LnkCandidate[]
  rejected: Array<{ label: string; reason: string }>
}

export function scanStartMenu(name: string, roots?: string[]): ScanResult {
  const searchRoots =
    roots ??
    [
      join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      join(process.env['APPDATA'] ?? '', 'Microsoft\\Windows\\Start Menu\\Programs')
    ]

  const candidates: LnkCandidate[] = []
  const rejected: Array<{ label: string; reason: string }> = []

  for (const root of searchRoots) {
    if (!existsSync(root)) continue
    const stack: string[] = [root]
    while (stack.length) {
      const dir = stack.pop() as string
      let entries: Array<{ isDirectory: () => boolean; name: string }> = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          stack.push(join(dir, e.name))
          continue
        }
        if (extname(e.name).toLowerCase() !== '.lnk') continue

        const full = join(dir, e.name)
        const label = basename(e.name, '.lnk')
        const dirName = basename(dir)

        if (looksLikeUninstaller(label)) {
          rejected.push({ label, reason: '文件名像卸载器' })
          continue
        }

        const q = name.trim().toLowerCase()
        const l = label.toLowerCase()
        const maybeMatch = l.includes(q) || dirName.toLowerCase().includes(q)
        const target = maybeMatch ? readLnkTarget(full) : ''

        const score = scoreCandidate({ label, dirName, target }, name)
        if (score < 0) {
          rejected.push({ label, reason: target ? '目标像卸载器' : '不匹配' })
          continue
        }

        candidates.push({ path: full, label, dirName, target, score })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.label.length - b.label.length)
  return { best: candidates[0] ?? null, candidates, rejected }
}
