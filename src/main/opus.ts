/**
 *
 *
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const OPUS_DIR_NAMES: Record<string, string> = {
  char_shorekeeper: 'shorekeeper',
  char_aemeath: 'aemeath',
  char_firefly: 'firefly',
  char_chloe: 'chloe'
}

/**
 *
 */
export function opusDir(characterId: string): string {
  const name = OPUS_DIR_NAMES[characterId] ?? characterId.replace(/^char_/, '')
  const candidates = [
    join(process.resourcesPath ?? '', 'opus', name),
    join(app.getAppPath(), 'resources', 'opus', name),
    join(app.getPath('userData'), '..', 'resources', 'opus', name),
    join(__dirname, '..', '..', 'resources', 'opus', name),
    join(__dirname, '..', '..', '..', 'resources', 'opus', name),
    join(process.cwd(), 'resources', 'opus', name),
    join(process.cwd(), '..', 'resources', 'opus', name)
  ]
  for (const dir of candidates) {
    try {
      if (existsSync(dir)) return dir
    } catch {
    }
  }
  return candidates[0]
}

function listOpus(characterId: string): Array<{ file: string; line: string; path: string }> {
  const dir = opusDir(characterId)
  if (!existsSync(dir)) return []
  const out: Array<{ file: string; line: string; path: string }> = []
  for (const f of readdirSync(dir)) {
    if (!/\.mp3$/i.test(f)) continue
    const base = f.replace(/\.mp3$/i, '')
    const m = base.match(/^\d+\s*(.+)$/)
    const line = m ? m[1].trim() : base.trim()
    out.push({ file: f, line, path: join(dir, f) })
  }
  return out
}

/**
 *
 *
 */
export function findOpusByLine(characterId: string, line: string): { path: string; file: string } | null {
  if (!line) return null
  const target = line.trim()
  const opus = listOpus(characterId)
  const exact = opus.find((o) => o.line === target)
  if (exact) return { path: exact.path, file: exact.file }
  const norm = (s: string): string => s.replace(/\s+/g, '').replace(/[，。！？、！？]/g, '')
  const fuzzy = opus.find((o) => norm(o.line) === norm(target))
  if (fuzzy) return { path: fuzzy.path, file: fuzzy.file }
  return null
}

export function opusToFileUrl(path: string): string {
  const norm = path.replace(/\\/g, '/')
  return 'appfile:///' + (norm.startsWith('/') ? norm.slice(1) : norm)
}

export function hasOpus(characterId: string): boolean {
  return listOpus(characterId).length > 0
}

export function opusStats(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of Object.keys(OPUS_DIR_NAMES)) {
    const n = listOpus(id).length
    if (n > 0) out[id] = n
  }
  return out
}
