/**
 *
 *   { spec: 'chara_card_v2', spec_version: '2.0', data: {...} }
 *
 *
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface WorldBookEntry {
  keys: string[]
  secondaryKeys: string[]
  content: string
  constant: boolean
  insertionOrder: number
  enabled: boolean
}

export interface CharacterCard {
  name: string
  spec: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  alternateGreetings: string[]
  mesExample: string
  systemPrompt: string
  postHistoryInstructions: string
  creatorNotes: string
  creator: string
  version: string
  tags: string[]
  worldBook: WorldBookEntry[]
  personaContent: string
  address: string
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim())
}

/**
 *
 */
function extractAddress(description: string): string {
  const explicit = description.match(/称呼\s*\{\{user\}\}\s*为\s*[「"“]?([^」"”，。、\n]{1,12})/)
  if (explicit) return explicit[1].replace(/[「」"“”]/g, '').trim()

  const explicit2 = description.match(/对\s*\{\{user\}\}\s*的称呼[：:]\s*[「"“]?([^」"”，。、\n]{1,12})/)
  if (explicit2) return explicit2[1].replace(/[「」"“”]/g, '').trim()

  const relSection = description.match(/【与\s*\{\{user\}\}\s*的关系】([\s\S]{0,900})/)
  const scope = relSection ? relSection[1] : description

  const implicit = scope.match(/\{\{user\}\}\s*是\s*([^，。、；\n]{1,12}?)(?:[，。、；\n]|$)/)
  if (implicit) {
    const cand = implicit[1]
      .replace(/[「」"“”]/g, '')
      .replace(/^(她的|他的|那个|一个|位)/, '')
      .trim()
    if (cand && cand.length <= 8 && !/人$|事$|东西|时候|地方|角色/.test(cand)) return cand
  }

  return '你'
}

/**
 */
function cleanName(raw: string): string {
  return raw
    .replace(/[-_—–\s]*陪伴版\s*$/g, '')
    .replace(/[-_—–\s]*companion\s*$/gi, '')
    .trim() || raw
}

/**
 *
 */
function buildPersonaContent(card: Omit<CharacterCard, 'personaContent'>): string {
  const parts: string[] = []

  parts.push(`# ${card.name} 人格`)
  parts.push(`（来自角色卡：${card.spec}${card.version ? ` v${card.version}` : ''}${card.creator ? ` · 作者 ${card.creator}` : ''}）`)

  if (card.description) {
    parts.push(`\n## 角色设定\n${card.description}`)
  }

  if (card.personality) {
    parts.push(`\n## 性格关键词\n${card.personality}`)
  }

  if (card.scenario) {
    parts.push(`\n## 场景\n${card.scenario}`)
  }

  if (card.mesExample) {
    parts.push(`\n## 示例对话（模仿这个语感）\n${card.mesExample}`)
  }

  if (card.systemPrompt) {
    parts.push(`\n## 输出格式要求\n${card.systemPrompt}`)
  }

  if (card.postHistoryInstructions) {
    parts.push(`\n## 硬性约束（必须遵守）\n${card.postHistoryInstructions}`)
  }

  if (card.worldBook.length) {
    const constant = card.worldBook.filter((e) => e.constant)
    const keyword = card.worldBook.filter((e) => !e.constant)
    const lines: string[] = []
    if (constant.length) {
      lines.push('【常驻设定】')
      for (const e of constant) lines.push(`- ${e.content}`)
    }
    if (keyword.length) {
      lines.push('【可能用到的设定】')
      for (const e of keyword) {
        lines.push(`- 关键词（${e.keys.slice(0, 5).join('/')}）：${e.content}`)
      }
    }
    parts.push(`\n## 世界观资料\n${lines.join('\n')}`)
  }

  parts.push(`\n## 占位符说明
- {{char}}（或 {char}）指你自己（${card.name}）
- {{user}}（或 {user}）指正在和你对话的用户，回复时直接称呼即可，不要输出花括号`)

  return parts.join('\n')
}

/**
 */
export function parseCardObject(raw: unknown): CharacterCard {
  if (!raw || typeof raw !== 'object') throw new Error('角色卡不是有效的 JSON 对象')

  const obj = raw as Record<string, unknown>
  const d = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>

  const name = cleanName(str(d.name)) || '未命名角色'
  const description = str(d.description)

  const book = (d.character_book ?? d.characterBook) as Record<string, unknown> | undefined
  const entries: WorldBookEntry[] = []
  if (book && Array.isArray(book.entries)) {
    for (const e of book.entries as Record<string, unknown>[]) {
      const content = str(e.content)
      if (!content) continue
      entries.push({
        keys: strArr(e.keys),
        secondaryKeys: strArr(e.secondary_keys ?? e.secondaryKeys),
        content,
        constant: e.constant === true,
        insertionOrder: typeof e.insertion_order === 'number' ? e.insertion_order : 100,
        enabled: e.enabled !== false
      })
    }
  }
  entries.sort((a, b) => a.insertionOrder - b.insertionOrder)

  const base = {
    name,
    spec: str(obj.spec) || 'chara_card_v1',
    description,
    personality: str(d.personality),
    scenario: str(d.scenario),
    firstMes: str(d.first_mes),
    alternateGreetings: strArr(d.alternate_greetings),
    mesExample: str(d.mes_example),
    systemPrompt: str(d.system_prompt),
    postHistoryInstructions: str(d.post_history_instructions),
    creatorNotes: str(d.creator_notes),
    creator: str(d.creator),
    version: str(d.character_version),
    tags: strArr(d.tags),
    worldBook: entries.filter((e) => e.enabled),
    address: extractAddress(description)
  }

  return { ...base, personaContent: buildPersonaContent(base) }
}

export function parseCardFile(path: string): CharacterCard {
  if (!existsSync(path)) throw new Error('角色卡文件不存在：' + path)
  const ext = extname(path).toLowerCase()
  if (ext !== '.json') throw new Error(`角色卡必须是 .json 文件，当前是 ${ext}`)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (e) {
    throw new Error('角色卡 JSON 解析失败：' + (e instanceof Error ? e.message : String(e)))
  }
  const card = parseCardObject(raw)
  if (!card.description && !card.personality && !card.systemPrompt) {
    throw new Error(`角色卡「${basename(path)}」里没有可用的人设内容`)
  }
  return card
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

/**
 */
export function pickWorldBook(entries: WorldBookEntry[], userText: string, limit = 6): WorldBookEntry[] {
  const t = userText.toLowerCase()
  const out: WorldBookEntry[] = []

  for (const e of entries) {
    if (e.constant) out.push(e)
  }

  for (const e of entries) {
    if (e.constant) continue
    if (out.length >= limit) break
    const hit = e.keys.some((k) => k && t.includes(k.toLowerCase()))
    if (hit) out.push(e)
  }

  return out.slice(0, limit)
}

export function renderWorldBook(entries: WorldBookEntry[]): string {
  if (!entries.length) return ''
  return `## 相关设定（来自角色卡世界书）\n${entries.map((e) => `- ${e.content}`).join('\n')}`
}
