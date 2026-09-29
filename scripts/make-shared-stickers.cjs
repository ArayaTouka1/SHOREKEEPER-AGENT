/**
 *
 *
 *
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'resources', 'stickers')
const SRC = path.join(ROOT, 'shorekeeper')
const DEST = path.join(ROOT, '_shared')

console.log('\n================ 生成表情包共享池 ================\n')

if (!fs.existsSync(SRC)) {
  console.error('找不到源目录：' + SRC)
  process.exit(1)
}

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true })

const idx = JSON.parse(fs.readFileSync(path.join(SRC, 'index.json'), 'utf-8'))

let copied = 0
const newEntries = []

for (const s of idx.stickers) {
  const from = path.join(SRC, s.file)
  if (!fs.existsSync(from)) continue
  const to = path.join(DEST, s.file)
  fs.copyFileSync(from, to)
  copied++
  newEntries.push({
    ...s,
    id: s.id.replace('st_shorekeeper_', 'st_shared_'),
    source: 'shared',
    originalName: s.originalName
  })
}

fs.writeFileSync(
  path.join(DEST, 'index.json'),
  JSON.stringify(
    {
      characterId: '_shared',
      roleName: '共享池',
      count: newEntries.length,
      updatedAt: new Date().toISOString(),
      notice: '没有专属表情包的角色会回落到这里。给角色单独加图后会自动优先用自己的。',
      stickers: newEntries
    },
    null,
    2
  ),
  'utf-8'
)

const mb = (newEntries.reduce((a, e) => a + fs.statSync(path.join(DEST, e.file)).size, 0) / 1024 / 1024).toFixed(1)
console.log(`  ✓ 共享池：${copied} 张，${mb} MB`)
console.log(`  输出：${DEST}\n`)
