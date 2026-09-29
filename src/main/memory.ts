import { JsonStore, uid } from './store'
import type { MemoryItem, MemoryKind } from '../shared/types'

interface MemoryState {
  items: MemoryItem[]
}

export const memoryStore = new JsonStore<MemoryState>('memory', () => ({ items: [] }))

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const words = lower.match(/[a-z0-9_]+/g) ?? []
  tokens.push(...words.filter((w) => w.length >= 2))
  const cjk = lower.replace(/[^\u4e00-\u9fa5]/g, ' ')
  for (const run of cjk.split(/\s+/).filter(Boolean)) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

const FACT_SIGNALS = [
  '我叫',
  '我的名字',
  '我是',
  '我喜欢',
  '我不喜欢',
  '我在做',
  '我正在',
  '我住在',
  '记住',
  '别忘了',
  '以后',
  '下次',
  '每天早上',
  '每天晚上'
]

/**
 */
const COMMAND_PATTERNS = [
  /(看下|看一下|看看|查下|查一下|查查|检查|读一下|报一下|给我看|帮我看|显示|告诉我)/,
  /(打开|启动|运行|拉起|关闭|退出|安装|卸载)/,
  /^(请|帮我|麻烦|来|去|给我)/
]

export function looksMemorable(text: string): boolean {
  const t = text.trim()
  if (t.length < 4) return false

  if (COMMAND_PATTERNS.some((re) => re.test(t))) return false

  if (FACT_SIGNALS.some((s) => t.includes(s))) return true

  if (/我的.{1,10}(是|叫|在|有|用|喜欢|住在|养着)/.test(t)) return true

  return /我.{0,6}(用|玩|做|学|写|住|养|开|有)\S{2,}/.test(t)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------
 *
 *
 * ------------------------------------------------------------------ */

export const SEED_MARKER = '诞生于这台电脑'

/**
 *
 */
const SEED_PATTERN = new RegExp(`^(?:.{0,16})?${SEED_MARKER}：`)

function looksLikeSeed(item: MemoryItem): boolean {
  if (item.kind === 'seed') return true
  const text = (item.text ?? '').trim()
  return text.startsWith(SEED_MARKER) || SEED_PATTERN.test(text)
}

/**
 */
export function purgeSeedMemories(): { removed: number; normalized: number } {
  const before = memoryStore.read().items
  if (!before.length) return { removed: 0, normalized: 0 }

  const kept: MemoryItem[] = []
  let removed = 0
  let normalized = 0

  for (const item of before) {
    if (looksLikeSeed(item)) {
      removed++
      continue
    }
    if (item.kind === 'fact') {
      kept.push({ ...item, kind: 'event' })
      normalized++
      continue
    }
    kept.push(item)
  }

  if (!removed && !normalized) return { removed: 0, normalized: 0 }

  memoryStore.update((s) => {
    s.items = kept
  })
  console.log(`[memory] 已清理旧种子记忆 ${removed} 条，归一「事实」记忆 ${normalized} 条`)
  return { removed, normalized }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export const memoryRepo = {
  /**
   *
   *
   */
  list(characterId?: string, conversationId?: string): MemoryItem[] {
    const items = memoryStore.read().items
    let filtered = items
    if (characterId) filtered = filtered.filter((m) => m.characterId === characterId)
    if (conversationId) {
      filtered = filtered.filter((m) => !m.conversationId || m.conversationId === conversationId)
    }
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt)
  },

  add(input: {
    text: string
    characterId: string
    conversationId?: string
    kind?: MemoryKind
    weight?: number
    tags?: string[]
  }): MemoryItem {
    const now = Date.now()
    const item: MemoryItem = {
      id: uid('mem'),
      kind: input.kind === 'fact' || !input.kind ? 'event' : input.kind,
      text: input.text.trim(),
      characterId: input.characterId,
      conversationId: input.conversationId,
      weight: input.weight ?? 0.5,
      hits: 0,
      createdAt: now,
      lastHitAt: null,
      tags: input.tags ?? tokenize(input.text).slice(0, 12)
    }
    memoryStore.update((s) => {
      s.items.push(item)
      if (s.items.length > 2000) {
        s.items.sort((a, b) => b.weight * 1000 + b.createdAt / 1e9 - (a.weight * 1000 + a.createdAt / 1e9))
        s.items = s.items.slice(0, 1800)
      }
    })
    return item
  },

  delete(id: string): MemoryItem[] {
    memoryStore.update((s) => {
      s.items = s.items.filter((m) => m.id !== id)
    })
    return this.list()
  },

  clear(characterId?: string): MemoryItem[] {
    memoryStore.update((s) => {
      s.items = characterId ? s.items.filter((m) => m.characterId !== characterId) : []
    })
    return this.list()
  },

  clearConversation(conversationId: string): MemoryItem[] {
    memoryStore.update((s) => {
      s.items = s.items.filter((m) => m.conversationId !== conversationId)
    })
    return this.list()
  },

  /**
   *
   */
  search(query: string, characterId: string, topK = 4, conversationId?: string): MemoryItem[] {
    const items = this.list(characterId, conversationId)
    if (!items.length) return []
    const qTokens = new Set(tokenize(query))
    if (!qTokens.size) {
      return items.sort((a, b) => b.weight - a.weight).slice(0, topK)
    }
    const now = Date.now()
    const scored = items.map((m) => {
      const mTokens = new Set(m.tags.length ? m.tags : tokenize(m.text))
      let overlap = 0
      for (const t of qTokens) if (mTokens.has(t)) overlap++
      const coverage = overlap / Math.max(1, qTokens.size)
      const ageDays = (now - m.createdAt) / 86400000
      const freshness = 1 / (1 + ageDays / 30)
      const score = coverage * 0.62 + m.weight * 0.28 + freshness * 0.1
      return { m, score, coverage }
    })
    const picked = scored
      .filter((s) => s.coverage > 0 || s.m.weight >= 0.85)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    if (picked.length) {
      const ids = new Set(picked.map((p) => p.m.id))
      memoryStore.update((s) => {
        for (const m of s.items) {
          if (ids.has(m.id)) {
            m.hits += 1
            m.lastHitAt = now
          }
        }
      })
    }
    return picked.map((p) => p.m)
  }
}
