/**
 *
 *
 */

import type { Character } from '../shared/types'
import type { PersonaCard } from './personaCard'
import { pickSticker, inferMood, listStickers, type Sticker } from './stickers'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface ProactiveDecision {
  send: boolean
  sticker: Sticker | null
  mood: string
  reason: string
  caption: string
}

const RATE: Record<string, number> = {
  char_aemeath: 3, // 活泼，爱发
  char_chloe: 5,
  char_firefly: 6, // 安静，少发
  char_shorekeeper: 6 // 克制，最少
}

const HOT_MOMENTS: Array<{ re: RegExp; mood: string }> = [
  { re: /(谢谢|多谢|感谢|辛苦了)/, mood: 'thanks' },
  { re: /(再见|拜拜|我走了|先走了|睡了|晚安)/, mood: 'farewell' },
  { re: /(你好|在吗|在不在|嗨|早上好|晚上好)/, mood: 'greeting' },
  { re: /(好累|累了|难受|不开心|难过|emo|崩溃)/, mood: 'sad' },
  { re: /(你真|好棒|厉害|喜欢你|可爱|真好)/, mood: 'praise' },
  { re: /(哈哈|笑死|太好玩|有趣)/, mood: 'happy' }
]

export interface ProactiveInput {
  character: Character
  card: PersonaCard
  userText: string
  replyText: string
  messageCount: number
  recentStickerIds: string[]
  hasImages?: boolean
  requested?: boolean
}

/**
 *
 */
export function decideProactiveSticker(input: ProactiveInput): ProactiveDecision {
  const { character, userText, replyText, messageCount, recentStickerIds, hasImages, requested } = input

  const mood = inferMood(userText + ' ' + replyText)
  const pool = listStickers(character.id)
  if (!pool.length) {
    return { send: false, sticker: null, mood, reason: '该角色没有表情包', caption: '' }
  }

  if (requested) {
    const r = pickSticker({ characterId: character.id, mood, recentIds: recentStickerIds })
    return {
      send: r.sticker !== null,
      sticker: r.sticker,
      mood,
      reason: '用户明确要求：' + r.reason,
      caption: ''
    }
  }

  if (hasImages) {
    return { send: false, sticker: null, mood, reason: '这条消息已经带图', caption: '' }
  }

  const every = RATE[character.id] ?? 5
  if (messageCount < 2 || messageCount % every !== 0) {
    return { send: false, sticker: null, mood, reason: `未到频率（每 ${every} 轮）`, caption: '' }
  }

  const hot = HOT_MOMENTS.find((h) => h.re.test(userText))
  const baseChance = hot ? 0.75 : 0.3

  if (Math.random() > baseChance) {
    return { send: false, sticker: null, mood, reason: `概率未中（${Math.round(baseChance * 100)}%）`, caption: '' }
  }

  const wantMood = hot ? hot.mood : mood
  const r = pickSticker({ characterId: character.id, mood: wantMood, recentIds: recentStickerIds })
  if (!r.sticker) {
    return { send: false, sticker: null, mood: wantMood, reason: '没挑到合适的', caption: '' }
  }

  return {
    send: true,
    sticker: r.sticker,
    mood: wantMood,
    reason: (hot ? '场景热度命中' : '常规概率') + ' · ' + r.reason,
    caption: Math.random() < 0.35 ? pickCaption(character.id, wantMood) : ''
  }
}

function pickCaption(characterId: string, mood: string): string {
  const byMood: Record<string, string[]> = {
    thanks: ['嗯。', '……不用谢。', '记着了。'],
    farewell: ['路上小心。', '……好。', '明天见。'],
    greeting: ['我在。', '嗯。', '来了。'],
    sad: ['我在这儿。', '……', '不用现在说。'],
    praise: ['……', '别说了。', '嗯。'],
    happy: ['……看得出来。', '嗯。', '不错。']
  }
  const pool = byMood[mood] ?? ['嗯。', '……', '知道了。']
  return pool[Math.floor(Math.random() * pool.length)]
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface AutoFetchDecision {
  fetch: boolean
  query: string
  reason: string
}

/**
 *
 */
export function decideAutoFetch(input: {
  poolSize: number
  messageCount: number
  everyNTurns: number
  characterName: string
  enabled: boolean
  recentFetchCount: number
}): AutoFetchDecision {
  if (!input.enabled) {
    return { fetch: false, query: '', reason: '自动抓取未开启' }
  }
  if (input.recentFetchCount >= 3) {
    return { fetch: false, query: '', reason: '本次会话已抓过 3 次，不再重复' }
  }

  if (input.poolSize === 0) {
    return {
      fetch: true,
      query: `${input.characterName} 表情包`,
      reason: '表情包库是空的，抓一批'
    }
  }

  const every = Math.max(4, input.everyNTurns)
  if (input.messageCount >= every && input.messageCount % every === 0) {
    return {
      fetch: true,
      query: `${input.characterName} 表情包`,
      reason: `每 ${every} 轮补充一批`
    }
  }

  return { fetch: false, query: '', reason: '未到抓取时机' }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export interface ImageReaction {
  text: string
  sticker: Sticker | null
  mood: string
}

export interface ImageReactionInput {
  character: Character
  count: number
  isSticker: boolean
  text: string
  recentStickerIds: string[]
}

/**
 *
 */
export function buildImageReaction(input: ImageReactionInput): ImageReaction {
  const { character, count, isSticker, text, recentStickerIds } = input
  const mood = isSticker ? 'happy' : 'think'

  const pool = pickReactionPool(character.id, isSticker, count)
  let reply = pool[Math.floor(Math.random() * pool.length)]

  if (text.trim()) {
    reply = reply + ' ' + (isSticker ? '……怎么突然发这个。' : '这个我看到了。')
  }

  let sticker: Sticker | null = null
  if (isSticker && Math.random() < 0.5) {
    const r = pickSticker({ characterId: character.id, mood: 'happy', recentIds: recentStickerIds })
    sticker = r.sticker
  } else if (!isSticker && Math.random() < 0.25) {
    const r = pickSticker({ characterId: character.id, mood: 'think', recentIds: recentStickerIds })
    sticker = r.sticker
  }

  return { text: reply, sticker, mood }
}

function pickReactionPool(characterId: string, isSticker: boolean, count: number): string[] {
  const many = count > 1

  if (characterId === 'char_aemeath') {
    return isSticker
      ? many
        ? ['诶诶诶一口气发这么多！', '哈哈这个我喜欢，收下了。', '你哪来这么多表情包啊。']
        : ['哈哈这个好可爱！', '诶！我也有这个。', '你发这个是想逗我笑吧。']
      : many
        ? ['哇这么多图。', '我一张张看啦。', '诶，这些都是给我的吗？']
        : ['诶，这是什么？', '让我看看……嗯。', '你拍的？']
  }

  if (characterId === 'char_chloe') {
    return isSticker
      ? many
        ? ['……你哪来的这么多。', '一张张发，幼稚。', '行了行了，收起来。']
        : ['……干嘛。', '幼稚。', '这算什么。']
      : many
        ? ['……这么多，我都懒得看。', '有话直说。', '放着吧。']
        : ['……什么这是。', '嗯，看到了。', '……拍得还行。']
  }

  if (characterId === 'char_firefly') {
    return isSticker
      ? many
        ? ['……好多。', '我一张张看。', '都收到了。']
        : ['……嗯。', '可爱。', '谢谢。']
      : many
        ? ['……我慢慢看。', '都是你选的？', '嗯，记下了。']
        : ['……我看看。', '嗯，看到了。', '……这个不错。']
  }

  return isSticker
    ? many
      ? ['……你今天是准备了多久。', '一口气发这么多。', '我一张张看。']
      : ['……收到。', '嗯。这个留着。', '怎么突然发这个。']
    : many
      ? ['……这么多。', '我慢慢看。', '都是什么。']
      : ['……我看看。', '嗯。', '记下了。']
}
