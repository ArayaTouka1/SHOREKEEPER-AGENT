/**
 *
 *
 *
 */

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const CARD_DIR = process.argv[2] || 'F:\\work\\2026-09-25-14-03-47\\outputs'
const PERSONA_DIR = join(ROOT, 'resources', 'personas')
const CARD_OUT = join(ROOT, 'resources', 'cards')

const CARD_MAP = [
  { file: '守岸人-陪伴版-角色卡.json', id: 'shorekeeper', name: '守岸人', latin: 'SHOREKEEPER' },
  { file: '爱弥斯-陪伴版-角色卡.json', id: 'aemeath', name: '爱弥斯', latin: 'AEMEATH' },
  { file: '流萤-陪伴版-角色卡.json', id: 'firefly', name: '流萤', latin: 'FIREFLY' },
  { file: '嘉神川克罗艾-陪伴版-角色卡.json', id: 'chloe', name: '嘉神川克罗艾', latin: 'CHLOE' }
]

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}
function strArr(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []
}

function cleanName(raw) {
  return (
    raw
      .replace(/[-_—–\s]*陪伴版\s*$/g, '')
      .replace(/[-_—–\s]*companion\s*$/gi, '')
      .trim() || raw
  )
}

function extractAddress(description) {
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

function buildPersonaContent(card) {
  const parts = []
  parts.push(`# ${card.name} 人格`)
  parts.push(`（来自角色卡：${card.spec}${card.version ? ` v${card.version}` : ''}${card.creator ? ` · 作者 ${card.creator}` : ''}）`)

  if (card.description) parts.push(`\n## 角色设定\n${card.description}`)
  if (card.personality) parts.push(`\n## 性格关键词\n${card.personality}`)
  if (card.scenario) parts.push(`\n## 场景\n${card.scenario}`)
  if (card.mesExample) parts.push(`\n## 示例对话（模仿这个语感）\n${card.mesExample}`)
  if (card.systemPrompt) parts.push(`\n## 输出格式要求\n${card.systemPrompt}`)
  if (card.postHistoryInstructions) parts.push(`\n## 硬性约束（必须遵守）\n${card.postHistoryInstructions}`)

  if (card.worldBook.length) {
    const constant = card.worldBook.filter((e) => e.constant)
    const keyword = card.worldBook.filter((e) => !e.constant)
    const lines = []
    if (constant.length) {
      lines.push('【常驻设定】')
      for (const e of constant) lines.push(`- ${e.content}`)
    }
    if (keyword.length) {
      lines.push('【可能用到的设定】')
      for (const e of keyword) lines.push(`- 关键词（${e.keys.slice(0, 5).join('/')}）：${e.content}`)
    }
    parts.push(`\n## 世界观资料\n${lines.join('\n')}`)
  }

  parts.push(`\n## 占位符说明
- {{char}}（或 {char}）指你自己（${card.name}）
- {{user}}（或 {user}）指正在和你对话的用户，回复时直接称呼即可，不要输出花括号`)

  return parts.join('\n')
}

function parseCard(raw) {
  const d = raw && typeof raw.data === 'object' && raw.data ? raw.data : raw
  const description = str(d.description)

  const book = d.character_book ?? d.characterBook
  const entries = []
  if (book && Array.isArray(book.entries)) {
    for (const e of book.entries) {
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
    entries.sort((a, b) => a.insertionOrder - b.insertionOrder)
  }

  return {
    name: cleanName(str(d.name)),
    spec: str(raw.spec) || 'chara_card_v1',
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
}

if (!existsSync(CARD_DIR)) {
  console.error('找不到角色卡目录：' + CARD_DIR)
  process.exit(1)
}

mkdirSync(PERSONA_DIR, { recursive: true })
mkdirSync(CARD_OUT, { recursive: true })

const summary = []

for (const m of CARD_MAP) {
  const src = join(CARD_DIR, m.file)
  if (!existsSync(src)) {
    console.error(`  跳过 ${m.file}（文件不存在）`)
    continue
  }

  const raw = JSON.parse(readFileSync(src, 'utf-8'))
  const card = parseCard(raw)
  const content = buildPersonaContent(card)

  writeFileSync(join(PERSONA_DIR, `${m.id}.txt`), content, 'utf-8')
  writeFileSync(join(CARD_OUT, `${m.id}.json`), JSON.stringify(raw, null, 2), 'utf-8')

  summary.push({
    id: m.id,
    name: card.name,
    chars: content.length,
    worldBook: card.worldBook.length,
    greetings: 1 + card.alternateGreetings.length,
    address: card.address
  })
}

console.log('\n导入结果：')
console.log('─'.repeat(96))
console.log('id'.padEnd(14) + '角色'.padEnd(18) + '人格字数'.padEnd(10) + '世界书'.padEnd(8) + '开场白'.padEnd(8) + '称呼')
console.log('─'.repeat(96))
for (const s of summary) {
  console.log(
    s.id.padEnd(14) +
      s.name.padEnd(18) +
      String(s.chars).padEnd(10) +
      String(s.worldBook).padEnd(8) +
      String(s.greetings).padEnd(8) +
      s.address
  )
}
console.log('─'.repeat(96))
console.log(`共 ${summary.length} 张卡 → resources/personas/ 与 resources/cards/\n`)
