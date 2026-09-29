/**
 *
 *
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export type StickerMood =
  | 'happy'
  | 'shy'
  | 'sad'
  | 'angry'
  | 'shock'
  | 'think'
  | 'calm'
  | 'heart'
  | 'cheer'
  | 'cry'
  | 'sleep'
  | 'wave'
  | 'thumbsup'
  | 'confuse'
  | 'cute'
  | 'eat'
  | 'gift'
  | 'star'
  | 'hug'
  | 'run'
  | 'music'
  | 'book'
  | 'bored'
  | 'flower'
  | 'cake'
  | 'akimbo'
  | 'piano'
  | 'neutral'
  | 'custom'

export interface Sticker {
  id: string
  file: string
  path: string
  characterId: string
  mood: StickerMood
  tags: string[]
  source: 'local' | 'user' | 'web'
  originalName?: string
  size?: number
}

export interface StickerIndex {
  characterId: string
  roleName?: string
  count: number
  updatedAt: string
  stickers: Array<{
    id: string
    file: string
    tags: string[]
    mood: string
    source: string
    originalName?: string
  }>
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function builtinStickerDir(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'stickers'),
    join(app.getAppPath(), 'resources', 'stickers'),
    join(app.getAppPath(), '..', 'resources', 'stickers'),
    join(__dirname, '..', '..', 'resources', 'stickers')
  ]
  for (const d of candidates) {
    if (existsSync(d)) return d
  }
  return join(process.resourcesPath ?? '', 'stickers')
}

export function userStickerDir(): string {
  const d = join(app.getPath('userData'), 'stickers')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function userDirOf(characterId: string): string {
  const d = join(userStickerDir(), stickerDirOf(characterId))
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

function readDirIndex(root: string, characterId: string, source: 'local' | 'user'): Sticker[] {
  const dir = join(root, characterId)
  if (!existsSync(dir)) return []

  const out: Sticker[] = []

  const idxFile = join(dir, 'index.json')
  if (existsSync(idxFile)) {
    try {
      const idx = JSON.parse(readFileSync(idxFile, 'utf-8')) as StickerIndex
      for (const s of idx.stickers ?? []) {
        const full = join(dir, s.file)
        if (!existsSync(full)) continue
        out.push({
          id: s.id,
          file: s.file,
          path: full,
          characterId,
          mood: (s.mood || 'neutral') as StickerMood,
          tags: s.tags ?? [],
          source: source === 'local' ? 'local' : (s.source as Sticker['source']) || 'user',
          originalName: s.originalName,
          size: statSync(full).size
        })
      }
      return out
    } catch {
    }
  }

  let files: string[] = []
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  let i = 0
  for (const f of files) {
    if (!IMG_EXT.includes(extname(f).toLowerCase())) continue
    i++
    const full = join(dir, f)
    out.push({
      id: `st_${characterId}_u${String(i).padStart(3, '0')}`,
      file: f,
      path: full,
      characterId,
      mood: 'custom',
      tags: ['用户添加'],
      source,
      size: statSync(full).size
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export function stickerDirOf(characterId: string): string {
  return characterId.replace(/^char_/, '')
}

/**
 *
 */
export function listStickers(characterId: string): Sticker[] {
  const dir = stickerDirOf(characterId)
  const local = readDirIndex(builtinStickerDir(), dir, 'local')
  const user = readDirIndex(userStickerDir(), dir, 'user')
  const own = [...local, ...user]
  if (own.length > 0) return own

  const sharedLocal = readDirIndex(builtinStickerDir(), '_shared', 'local')
  const sharedUser = readDirIndex(userStickerDir(), '_shared', 'user')
  return [...sharedLocal, ...sharedUser]
}

export function hasOwnStickers(characterId: string): boolean {
  const dir = stickerDirOf(characterId)
  return (
    readDirIndex(builtinStickerDir(), dir, 'local').length > 0 || readDirIndex(userStickerDir(), dir, 'user').length > 0
  )
}

export function stickerStats(): Array<{ characterId: string; count: number; local: number; user: number }> {
  const ids = new Set<string>()
  for (const root of [builtinStickerDir(), userStickerDir()]) {
    try {
      for (const d of readdirSync(root, { withFileTypes: true })) {
        if (d.isDirectory()) ids.add(d.name)
      }
    } catch {
      /* ignore */
    }
  }
  return [...ids].map((id) => {
    const local = readDirIndex(builtinStickerDir(), id, 'local').length
    const user = readDirIndex(userStickerDir(), id, 'user').length
    return { characterId: id, count: local + user, local, user }
  })
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const MOOD_MAP: Record<string, StickerMood[]> = {
  praise: ['shy', 'happy', 'heart', 'cute'],
  happy: ['happy', 'cheer', 'star', 'heart'],
  sad: ['sad', 'calm', 'heart', 'hug'],
  comfort: ['calm', 'heart', 'hug', 'sad'],
  angry: ['confuse', 'calm', 'sad'],
  shock: ['shock', 'confuse', 'think'],
  care: ['calm', 'heart', 'think'],
  greeting: ['wave', 'happy', 'heart'],
  farewell: ['wave', 'calm', 'sad'],
  thanks: ['shy', 'happy', 'heart'],
  question: ['think', 'confuse', 'calm'],
  chat: ['calm', 'happy', 'think', 'shy']
}

const KEYWORD_MOOD: Array<{ re: RegExp; mood: string }> = [
  { re: /(好累|累了|难受|不开心|难过|emo|崩溃|压力|烦)/, mood: 'sad' },
  { re: /(谢谢|多谢|感谢|辛苦了)/, mood: 'thanks' },
  { re: /(再见|拜拜|我走了|先走了|下线|睡了)/, mood: 'farewell' },
  { re: /(你好|在吗|在不在|嗨|早上好|晚上好|晚安)/, mood: 'greeting' },
  { re: /(你真|好棒|厉害|喜欢你|可爱|真好|牛|强)/, mood: 'praise' },
  { re: /(生气|讨厌|烦死|别烦|滚)/, mood: 'angry' },
  { re: /(真的吗|不会吧|居然|竟然|天啊)/, mood: 'shock' },
  { re: /(熬夜|没睡|几点睡|吃了没|吃了吗|下雨|窗没关|降温|你在干嘛)/, mood: 'care' },
  { re: /(\?|？|为什么|怎么|是什么|吗$)/, mood: 'question' }
]

export function inferMood(text: string): string {
  const t = text.trim()
  for (const k of KEYWORD_MOOD) {
    if (k.re.test(t)) return k.mood
  }
  return 'chat'
}

export interface PickOptions {
  characterId: string
  mood: string
  recentIds?: string[]
  preferTags?: string[]
}

export interface PickResult {
  sticker: Sticker | null
  reason: string
}

/**
 */
export function pickSticker(opts: PickOptions): PickResult {
  const all = listStickers(opts.characterId)
  if (!all.length) return { sticker: null, reason: '该角色没有表情包' }

  const recent = new Set(opts.recentIds ?? [])
  const preferred = MOOD_MAP[opts.mood] ?? MOOD_MAP.chat

  if (opts.preferTags?.length) {
    const hit = all.filter(
      (s) => !recent.has(s.id) && s.tags.some((t) => opts.preferTags!.some((p) => t.includes(p)))
    )
    if (hit.length) {
      return { sticker: hit[Math.floor(Math.random() * hit.length)], reason: '标签命中：' + opts.preferTags.join('/') }
    }
  }

  for (const m of preferred) {
    const hit = all.filter((s) => s.mood === m && !recent.has(s.id))
    if (hit.length) {
      return { sticker: hit[Math.floor(Math.random() * hit.length)], reason: '情绪命中：' + m }
    }
  }

  for (const m of preferred) {
    const hit = all.filter((s) => s.mood === m)
    if (hit.length) {
      return { sticker: hit[Math.floor(Math.random() * hit.length)], reason: '情绪命中（忽略近期）：' + m }
    }
  }

  const any = all.filter((s) => !recent.has(s.id))
  const pool = any.length ? any : all
  return { sticker: pool[Math.floor(Math.random() * pool.length)], reason: '兜底随机' }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function addSticker(characterId: string, sourcePath: string, mood?: string, tags?: string[]): Sticker {
  if (!existsSync(sourcePath)) throw new Error('文件不存在：' + sourcePath)
  const ext = extname(sourcePath).toLowerCase()
  if (!IMG_EXT.includes(ext)) throw new Error(`不支持的格式 ${ext}，请用 jpg / png / webp / gif`)

  const dir = userDirOf(characterId)
  const name = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}${ext}`
  const dest = join(dir, name)
  copyFileSync(sourcePath, dest)

  const idxFile = join(dir, 'index.json')
  let idx: StickerIndex
  try {
    idx = JSON.parse(readFileSync(idxFile, 'utf-8')) as StickerIndex
  } catch {
    idx = { characterId, count: 0, updatedAt: '', stickers: [] }
  }

  const id = `st_${characterId}_user_${idx.stickers.length + 1}`
  idx.stickers.push({
    id,
    file: name,
    tags: tags ?? ['用户添加'],
    mood: mood ?? 'custom',
    source: 'user',
    originalName: basename(sourcePath)
  })
  idx.count = idx.stickers.length
  idx.updatedAt = new Date().toISOString()
  writeFileSync(idxFile, JSON.stringify(idx, null, 2), 'utf-8')

  return {
    id,
    file: name,
    path: dest,
    characterId,
    mood: (mood ?? 'custom') as StickerMood,
    tags: tags ?? ['用户添加'],
    source: 'user',
    size: statSync(dest).size
  }
}

export function removeSticker(characterId: string, stickerId: string): boolean {
  const dir = userDirOf(characterId)
  const idxFile = join(dir, 'index.json')
  if (!existsSync(idxFile)) return false

  let idx: StickerIndex
  try {
    idx = JSON.parse(readFileSync(idxFile, 'utf-8')) as StickerIndex
  } catch {
    return false
  }

  const hit = idx.stickers.find((s) => s.id === stickerId)
  if (!hit) return false

  try {
    const full = join(dir, hit.file)
    if (existsSync(full)) require('node:fs').unlinkSync(full)
  } catch {
  }

  idx.stickers = idx.stickers.filter((s) => s.id !== stickerId)
  idx.count = idx.stickers.length
  idx.updatedAt = new Date().toISOString()
  writeFileSync(idxFile, JSON.stringify(idx, null, 2), 'utf-8')
  return true
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface WebSource {
  id: string
  label: string
  hint: string
}

export const WEB_SOURCES: WebSource[] = [
  { id: 'bing', label: 'Bing 图片', hint: '搜索关键词抓取缩略图（公共图库）' },
  { id: 'url', label: '指定图片直链', hint: '直接粘贴图片 URL 下载' },
  { id: 'page', label: '网页扒图', hint: '给一个网页地址，抓取页面里的图片' }
]

export interface SearchResult {
  url: string
  thumbnail?: string
  title?: string
  width?: number
  height?: number
}

export async function searchWebStickers(query: string, limit = 60, first = 1): Promise<SearchResult[]> {
  const q = encodeURIComponent(query)
  const url = `https://www.bing.com/images/search?q=${q}&first=${first}&count=${Math.min(80, limit)}`

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  })
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)

  const html = await res.text()
  const out: SearchResult[] = []
  const seen = new Set<string>()

  for (const m of html.matchAll(/m="(\{[^"]+\})"/g)) {
    try {
      const obj = JSON.parse(m[1].replace(/&quot;/g, '"'))
      const murl = obj.murl as string
      if (!murl || seen.has(murl)) continue
      if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(murl)) continue
      seen.add(murl)
      out.push({
        url: murl,
        thumbnail: obj.turl as string,
        title: obj.t as string
      })
      if (out.length >= limit) break
    } catch {
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export async function searchBySource(sourceUrlTemplate: string, query: string, limit = 24): Promise<SearchResult[]> {
  const url = sourceUrlTemplate.replace('{q}', encodeURIComponent(query))

  if (/bing\.com/i.test(url)) {
    return searchWebStickers(query, limit)
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: new URL(url).origin
    }
  })
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)

  const html = await res.text()
  const out: SearchResult[] = []
  const seen = new Set<string>()

  const push = (u: string): void => {
    if (!u || seen.has(u)) return
    let abs = u
    if (abs.startsWith('//')) abs = 'https:' + abs
    else if (abs.startsWith('/')) abs = new URL(url).origin + abs
    if (!/^https?:/i.test(abs)) return
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(abs)) return
    seen.add(abs)
    out.push({ url: abs })
  }

  for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-img)=["']([^"']+)["']/gi)) {
    push(m[1])
    if (out.length >= limit) break
  }

  if (out.length < limit) {
    for (const m of html.matchAll(/"(?:objURL|thumbURL|middleURL|murl|hoverURL)"\s*:\s*"([^"]+)"/g)) {
      push(m[1].replace(/\\\//g, '/'))
      if (out.length >= limit) break
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export async function searchAllSources(
  query: string,
  limit = 60,
  sources: Array<{ searchUrl: string; enabled: boolean }> = []
): Promise<SearchResult[]> {
  const active =
    sources.length > 0
      ? sources.filter((s) => s.enabled)
      : [
          { searchUrl: 'https://www.bing.com/images/search?q={q}', enabled: true },
          { searchUrl: 'https://image.baidu.com/search/index?tn=baiduimage&word={q}', enabled: true },
          { searchUrl: 'https://pic.sogou.com/pics?query={q}', enabled: true }
        ]

  const seen = new Set<string>()
  const out: SearchResult[] = []

  const perSource = Math.max(10, Math.ceil(limit / Math.max(1, active.length)))

  await Promise.all(
    active.map(async (src) => {
      try {
        const r = await searchBySource(src.searchUrl, query, perSource)
        for (const item of r) {
          if (seen.has(item.url)) continue
          seen.add(item.url)
          out.push(item)
        }
      } catch {
      }
    })
  )

  return out.slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface AutoFetchResult {
  fetched: number
  source: string
  reason: string
}

/**
 *
 */
export async function autoFetchStickers(opts: {
  characterId: string
  query: string
  sourceUrl: string
  sourceLabel: string
  max: number
  existingIds?: string[]
}): Promise<AutoFetchResult> {
  const max = Math.max(1, Math.min(10, opts.max))

  let candidates: SearchResult[] = []
  try {
    candidates = await searchBySource(opts.sourceUrl, opts.query, max * 4)
  } catch (e) {
    return { fetched: 0, source: opts.sourceLabel, reason: e instanceof Error ? e.message : '搜索失败' }
  }

  if (!candidates.length) {
    return { fetched: 0, source: opts.sourceLabel, reason: '这个来源没搜到图' }
  }

  const existing = new Set(opts.existingIds ?? [])
  let ok = 0
  const errors: string[] = []

  for (const c of candidates) {
    if (ok >= max) break
    if (existing.has(c.url)) continue
    try {
      await downloadSticker(opts.characterId, c.url, 'custom', ['自动抓取', opts.sourceLabel])
      ok++
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  if (ok === 0) {
    return {
      fetched: 0,
      source: opts.sourceLabel,
      reason: errors.length ? '下载都失败了：' + errors[0] : '没有新的可用图片'
    }
  }

  return { fetched: ok, source: opts.sourceLabel, reason: '' }
}

export async function scrapePageImages(pageUrl: string, limit = 60): Promise<SearchResult[]> {
  const res = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' }
  })
  if (!res.ok) throw new Error(`打开网页失败 HTTP ${res.status}`)

  const html = await res.text()
  const base = new URL(pageUrl)
  const out: SearchResult[] = []
  const seen = new Set<string>()

  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    let src = m[1]
    if (src.startsWith('//')) src = base.protocol + src
    else if (src.startsWith('/')) src = base.origin + src
    else if (!/^https?:/i.test(src)) continue
    if (seen.has(src)) continue
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(src)) continue
    seen.add(src)
    out.push({ url: src })
    if (out.length >= limit) break
  }
  return out
}

export async function downloadSticker(
  characterId: string,
  imageUrl: string,
  mood?: string,
  tags?: string[]
): Promise<Sticker> {
  const res = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
      Referer: new URL(imageUrl).origin
    }
  })
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('下载到空文件')
  if (buf.length > 12 * 1024 * 1024) throw new Error('图片超过 12MB，已跳过')

  const ct = res.headers.get('content-type') ?? ''
  let ext = '.jpg'
  if (ct.includes('png')) ext = '.png'
  else if (ct.includes('webp')) ext = '.webp'
  else if (ct.includes('gif')) ext = '.gif'
  else {
    const m = imageUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)
    if (m) ext = '.' + m[1].toLowerCase()
  }

  const dir = userDirOf(characterId)
  const name = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}${ext}`
  const dest = join(dir, name)
  writeFileSync(dest, buf)

  const idxFile = join(dir, 'index.json')
  let idx: StickerIndex
  try {
    idx = JSON.parse(readFileSync(idxFile, 'utf-8')) as StickerIndex
  } catch {
    idx = { characterId, count: 0, updatedAt: '', stickers: [] }
  }

  const id = `st_${characterId}_web_${idx.stickers.length + 1}`
  idx.stickers.push({
    id,
    file: name,
    tags: tags ?? ['网络搜集'],
    mood: mood ?? 'custom',
    source: 'web'
  })
  idx.count = idx.stickers.length
  idx.updatedAt = new Date().toISOString()
  writeFileSync(idxFile, JSON.stringify(idx, null, 2), 'utf-8')

  return {
    id,
    file: name,
    path: dest,
    characterId,
    mood: (mood ?? 'custom') as StickerMood,
    tags: tags ?? ['网络搜集'],
    source: 'web',
    size: buf.length
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 *
 */
export function stickerToFileUrl(sticker: Sticker): string {
  return 'file:///' + sticker.path.replace(/\\/g, '/')
}

export function stickerToDataUrl(sticker: Sticker): string {
  try {
    const buf = readFileSync(sticker.path)
    const ext = extname(sticker.path).toLowerCase()
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}
