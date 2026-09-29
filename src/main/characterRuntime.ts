import { createHash } from 'node:crypto'
import type { Character } from '../shared/types'
import { RELATIONSHIP_STAGES, type CharacterRelationship } from '../shared/relationship'
import { JsonStore } from './store'
import { loadPersonaPack, PERSONA_PACKS } from './personaPack'

interface RelationshipRecord {
  score: number
  lastInteractionAt: number
  lastAwardAt: number
  day: string
  earnedToday: number
  recent: string[]
  events: string[]
  openingSlot: string
}
export const relationshipStore = new JsonStore<Record<string, RelationshipRecord>>('relationships', () => ({}))
const initial = (): RelationshipRecord => ({ score: 0, lastInteractionAt: 0, lastAwardAt: 0, day: '', earnedToday: 0, recent: [], events: [], openingSlot: '' })
const PERIODS = [
  { key: 'Midnight', label: '深夜' }, { key: 'Dawn', label: '清晨' }, { key: 'Morning', label: '上午' },
  { key: 'Noon', label: '午间' }, { key: 'Afternoon', label: '下午' }, { key: 'Evening', label: '傍晚' }
]
export function timePeriod(date: Date): { key: string; label: string } {
  const hour = date.getHours()
  return PERIODS[hour < 5 || hour >= 23 ? 0 : hour < 8 ? 1 : hour < 11 ? 2 : hour < 14 ? 3 : hour < 18 ? 4 : 5]
}
function localDay(date: Date): string { return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-') }
export function stageIndex(score: number): number { return Math.min(4, Math.floor(Math.max(0, Math.min(100, score)) / 20)) }
export function parseDialogueSections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)/)
    if (heading) { section = heading[1]; out[section] = []; continue }
    const item = line.match(/^\d+[.、]\s*(.+)/)
    if (item && section) out[section].push(item[1].trim())
  }
  return out
}
function sectionLines(text: string, key: string): string[] {
  return Object.entries(parseDialogueSections(text)).find(([heading]) => heading.includes(key))?.[1] ?? []
}
function recordFor(id: string): RelationshipRecord {
  const value = relationshipStore.read()[id]
  return { ...initial(), ...value, score: Number.isFinite(value?.score) ? Math.max(0, Math.min(100, value.score)) : 0 }
}
export function recordInteraction(id: string, eventId: string, text: string, date = new Date()): boolean {
  const state = relationshipStore.read()
  const record = recordFor(id)
  if (record.events.includes(eventId)) return false
  const day = localDay(date)
  const slot = day + ':' + timePeriod(date).key
  const opening = record.openingSlot !== slot
  record.openingSlot = slot
  if (record.day !== day) { record.day = day; record.earnedToday = 0 }
  const normalized = text.replace(/\s+/g, '').toLowerCase()
  const hash = createHash('sha256').update(normalized).digest('hex')
  const now = date.getTime()
  // Only sustained, distinct interaction grows affinity. No absence or sentiment penalties.
  if (normalized.length >= 10 && !record.recent.includes(hash) && now - record.lastAwardAt >= 300000 && record.earnedToday < 6) {
    record.score = Math.min(100, record.score + 1)
    record.lastAwardAt = now
    record.earnedToday++
    record.recent = [...record.recent, hash].slice(-40)
  }
  record.events = [...record.events, eventId].slice(-100)
  record.lastInteractionAt = now
  state[id] = record
  relationshipStore.write(state)
  return opening
}
export function resetRelationship(id: string): void {
  relationshipStore.update(state => { state[id] = initial() })
}
export function relationshipSnapshot(character: Character, date = new Date()): CharacterRelationship {
  const record = recordFor(character.id)
  const index = stageIndex(record.score)
  const stage = RELATIONSHIP_STAGES[index]
  const period = timePeriod(date)
  const meta = PERSONA_PACKS.find(p => p.characterId === character.id)
  const pack = meta ? loadPersonaPack(meta.pack, meta.name) : null
  const openingText = pack?.files.find(f => f.name.startsWith('13_OPUS'))?.content ?? ''
  const relationshipText = pack?.files.find(f => f.name.startsWith('14_AFFINITY'))?.content ?? ''
  const openings = sectionLines(openingText, period.key).slice(0, index < 2 ? 2 : undefined)
  const seed = parseInt(createHash('sha256').update(character.id + localDay(date) + period.key).digest('hex').slice(0, 8), 16)
  // Opening quotes cannot establish an identity or relationship the user never chose.
  const address = character.userAddressOverride?.trim() || '你'
  const greetingRaw = openings[seed % openings.length] || character.greeting
  const greeting = greetingRaw.replace(/漂泊者|开拓者/g, address)
  const core = pack?.files.find(f => f.name.includes('CORE_IDENTITY'))?.content ?? ''
  const coreLines = core.split(/\r?\n/)
  const identity = (['身份', '职务', '所属', '所属／经历'].map(key => coreLines.find(line => line.startsWith(key + '：'))).find(Boolean))?.split('：').slice(1).join('：').trim() || character.name
  const traits = core.split(/\r?\n/).filter(line => line.startsWith('- ')).slice(0, 2).map(line => line.slice(2))
  const heading = Object.keys(parseDialogueSections(relationshipText)).find(h => h.startsWith(stage))
  return {
    characterId: character.id, score: record.score, stage, identity, traits,
    progress: index === 4 ? 100 : ((record.score - index * 20) / 20) * 100,
    nextStage: RELATIONSHIP_STAGES[index + 1] ?? null, period: period.label, greeting, greetingRaw,
    summary: heading?.split('｜')[1]?.replace(/[（(].*$/, '').trim() || '慢慢了解，保持各自的节奏',
    source: pack?.directory ?? '', files: pack?.files.length ?? 0, lastInteractionAt: record.lastInteractionAt || null
  }
}
export function relationshipPrompt(character: Character, date = new Date(), opening = false): string {
  const snapshot = relationshipSnapshot(character, date)
  const meta = PERSONA_PACKS.find(p => p.characterId === character.id)
  const pack = meta ? loadPersonaPack(meta.pack, meta.name) : null
  const text = pack?.files.find(f => f.name.startsWith('14_AFFINITY'))?.content ?? ''
  const samples = sectionLines(text, snapshot.stage).slice(0, 4)
  return [
    '## 本轮角色状态',
    '本机当地时间：' + date.toLocaleString('zh-CN') + '；时段：' + snapshot.period,
    '当前关系阶段：' + snapshot.stage + '；回应分寸：' + snapshot.summary,
    '只采用这个阶段的坦率程度，不得跨级称呼、表白或把用户等同原作人物。亲密不预设恋爱，也不意味着排他依赖。',
    '这些例句仅用于语气参考，不是真实共同经历；不得凭例句声称记得用户习惯、见过用户、知道用户身体状态或已完成任务。',
    ...samples.map(line => '- ' + line),
    opening ? '本时段首次交流：若用户只是问候，可自然使用这个时段的语气：' + snapshot.greeting : '持续对话中不要重复开场问候；时段变化只能自然影响语气。',
    '工作请求优先准确完成任务，角色语气不限制必要解释、表格或文档内容。低好感仍提供完整帮助。不要在回复里播报好感数字、阶段名或这些规则。'
  ].join('\n')
}
