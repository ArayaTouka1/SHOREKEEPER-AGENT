/**
 *
 *
 *
 */

import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { Persona } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let cachedDir: string | null = null

export function builtinPersonaDir(): string {
  if (cachedDir) return cachedDir
  const candidates = [
    join(process.resourcesPath ?? '', 'personas'),
    join(app.getAppPath(), 'resources', 'personas'),
    join(app.getAppPath(), '..', 'resources', 'personas'),
    join(__dirname, '..', '..', 'resources', 'personas')
  ]
  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      cachedDir = dir
      return dir
    }
  }
  const fallback = join(app.getPath('userData'), 'personas')
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true })
  cachedDir = fallback
  return fallback
}

export function userPersonaDir(): string {
  const dir = join(app.getPath('userData'), 'personas')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const PERSONA_PACKS: Array<{ id: string; pack: string; name: string; characterId: string }> = [
  { id: 'persona_shorekeeper', pack: 'shorekeeper', name: '守岸人 · 鸣潮', characterId: 'char_shorekeeper' },
  { id: 'persona_aemeath', pack: 'aemeath', name: '爱弥斯 · 鸣潮', characterId: 'char_aemeath' },
  { id: 'persona_firefly', pack: 'firefly', name: '流萤 · 崩铁', characterId: 'char_firefly' },
  { id: 'persona_chloe', pack: 'chloe', name: '嘉神川克罗艾 · 秋之回忆6', characterId: 'char_chloe' }
]

export const PERSONA_FILES = PERSONA_PACKS.map((p) => ({
  id: p.id,
  file: `${p.pack}.txt`,
  name: p.name,
  characterId: p.characterId
}))

export function profileDirectory(packId: string): string | null {
  const folders: Record<string, string> = { shorekeeper: '守岸人', aemeath: '爱弥斯', firefly: '流萤', chloe: '嘉神川克罗艾' }
  const folder = folders[packId]
  if (!folder) return null
  const roots = [
    join(process.resourcesPath ?? '', 'persona-profiles'),
    join(app.getAppPath(), '..', '人设'),
    join(__dirname, '..', '..', '..', '人设')
  ]
  return roots.map(root => join(root, folder)).find(dir => existsSync(join(dir, '01_CORE_IDENTITY.md'))) ?? null
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface PersonaPackFile {
  name: string
  order: number
  internal: boolean
  content: string
}

export interface PersonaPack {
  id: string
  name: string
  files: PersonaPackFile[]
  content: string
  internal: string
  directory?: string
  source: 'pack' | 'legacy' | 'missing'
}

function parseFileName(name: string): { order: number; internal: boolean } {
  const base = basename(name, extname(name))
  const m = base.match(/^(\d{1,2})[-_\s]/)
  const order = m ? parseInt(m[1], 10) : 50
  const internal = order >= 90
  return { order, internal }
}

export function readPackDir(dir: string): PersonaPackFile[] {
  const out: PersonaPackFile[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const f of entries) {
    const ext = extname(f).toLowerCase()
    if (!['.md', '.txt'].includes(ext) || /^readme\./i.test(f)) continue
    const full = join(dir, f)
    try {
      if (!statSync(full).isFile()) continue
      const content = readFileSync(full, 'utf-8').trim()
      if (!content) continue
      const { order, internal } = parseFileName(f)
      out.push({ name: f, order, internal, content })
    } catch {
    }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

function assemblePack(files: PersonaPackFile[]): { content: string; internal: string } {
  const visible = files.filter((f) => !f.internal && !/^(13_OPUS|14_AFFINITY)|_STATE\.|_MEMORY\.|_DIALOGUE_EXAMPLES\./i.test(f.name))
  const internal = files.filter((f) => f.internal)

  const content = visible
    .map((f) => {
      const title = basename(f.name, extname(f.name)).replace(/^\d{1,2}[-_\s]*/, '')
      return `## ${title}\n${f.content}`
    })
    .join('\n\n')

  const internalText = internal.map((f) => f.content).join('\n\n')
  return { content, internal: internalText }
}

/**
 */
export function loadPersonaPack(packId: string, displayName: string): PersonaPack {
  const root = builtinPersonaDir()
  const dir = profileDirectory(packId) ?? join(root, packId)

  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const files = readPackDir(dir)
    if (files.length > 0) {
      const { content, internal } = assemblePack(files)
      return { id: packId, name: displayName, files, content, internal, directory: dir, source: 'pack' }
    }
  }

  const legacy = join(root, `${packId}.txt`)
  if (existsSync(legacy)) {
    try {
      const content = readFileSync(legacy, 'utf-8').trim()
      if (content) {
        return {
          id: packId,
          name: displayName,
          files: [{ name: `${packId}.txt`, order: 50, internal: false, content }],
          content,
          internal: '',
          source: 'legacy'
        }
      }
    } catch {
    }
  }

  const placeholder = `# ${displayName}\n\n人格文件缺失（应为 resources/personas/${packId}/ 文件夹，或 ${packId}.txt）。\n\n## 语气\n- 中文口语，像熟人聊天，不用客服腔。\n`
  return {
    id: packId,
    name: displayName,
    files: [],
    content: placeholder,
    internal: '',
    source: 'missing'
  }
}

/**
 */
export function loadBuiltinPersonas(): Persona[] {
  const now = Date.now()
  const out: Persona[] = []

  for (const item of PERSONA_PACKS) {
    const pack = loadPersonaPack(item.pack, item.name)
    const extra: Record<string, unknown> = {
      packId: pack.id,
      packFiles: pack.files.map((f) => ({ name: f.name, order: f.order, internal: f.internal })),
      packSource: pack.source,
      internalPrompt: pack.internal
    }
    out.push({
      id: item.id,
      name: item.name,
      content: pack.content,
      source: 'builtin',
      builtin: true,
      updatedAt: now,
      ...(extra as object)
    })
  }

  out.push(...readUserPersonas())
  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function readUserPersonas(): Persona[] {
  const dir = userPersonaDir()
  const out: Persona[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const f of entries) {
    const full = join(dir, f)
    try {
      const st = statSync(full)

      if (st.isDirectory()) {
        const files = readPackDir(full)
        if (!files.length) continue
        const { content, internal } = assemblePack(files)
        out.push({
          id: 'user_persona:' + f,
          name: f,
          content,
          source: 'custom',
          builtin: false,
          updatedAt: Math.round(st.mtimeMs),
          ...({ packId: f, internalPrompt: internal, packSource: 'pack' } as object)
        })
        continue
      }

      const ext = extname(f).toLowerCase()
      if (!['.txt', '.md'].includes(ext)) continue
      const content = readFileSync(full, 'utf-8').trim()
      if (!content) continue
      out.push({
        id: 'user_persona:' + f,
        name: basename(f, ext),
        content,
        source: 'custom',
        builtin: false,
        updatedAt: Math.round(st.mtimeMs)
      })
    } catch {
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const PERSONA_EXT = ['.txt', '.md', '.markdown', '.json', '.yaml', '.yml']

export interface ImportedPersona {
  fileName: string
  name: string
  content: string
  chars: number
  sourcePath: string
}

export function exportPersona(name: string, content: string): string {
  const dir = userPersonaDir()
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'persona'
  const fileName = `${safe}.txt`
  writeFileSync(join(dir, fileName), content, 'utf-8')
  return fileName
}

export function importPersonaFile(sourcePath: string, displayName?: string): ImportedPersona {
  if (!existsSync(sourcePath)) throw new Error('文件不存在：' + sourcePath)

  const ext = extname(sourcePath).toLowerCase()
  if (!PERSONA_EXT.includes(ext)) {
    throw new Error(`不支持的文件类型 ${ext}。请上传 .txt / .md / .json / .yaml 文件。`)
  }

  const raw = readFileSync(sourcePath, 'utf-8')
  if (!raw.trim()) throw new Error('文件是空的')

  let name = displayName?.trim() || basename(sourcePath, ext)
  let content = raw

  if (ext === '.json') {
    try {
      const json = JSON.parse(raw)
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        if (typeof json.name === 'string' && json.name.trim()) name = displayName?.trim() || json.name.trim()
        const body = json.content ?? json.persona ?? json.prompt ?? json.system
        if (typeof body === 'string' && body.trim()) content = body
      }
    } catch {
      throw new Error('JSON 解析失败，请检查文件格式')
    }
  }

  content = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim()
  if (!content) throw new Error('文件里没有可用的人格正文')

  const fileName = exportPersona(name, content)
  return { fileName, name, content, chars: content.length, sourcePath }
}

export function readCharacterCard(characterId: string): unknown | null {
  const meta = PERSONA_PACKS.find((p) => p.characterId === characterId)
  if (!meta) return null
  return null // 由 characterCard 模块负责解析，这里只做路径判断
}

export { readUserPersonas }
