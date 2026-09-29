/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const FFMPEG = 'C:\\Users\\Administrator\\.dsh-wallpaper-engine\\ffmpeg\\ffmpeg.exe'
const SRC_ROOT = 'F:\\work\\aiagent\\表情包'
const OUT_ROOT = path.resolve(__dirname, '..', 'resources', 'stickers')

const ROLE_MAP = {
  守岸人: 'shorekeeper',
  爱弥斯: 'aemeath',
  流萤: 'firefly',
  克罗艾: 'chloe',
  嘉神川克罗艾: 'chloe'
}

const MAX_W = 480

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

function probeSize(file) {
  try {
    const out = execFileSync(FFMPEG, ['-hide_banner', '-i', file], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return out
  } catch (e) {
    const s = String(e.stderr || '')
    const m = s.match(/(\d{2,5})x(\d{2,5})/)
    return m ? `${m[1]}x${m[2]}` : ''
  }
}

function convert(src, dest) {
  execFileSync(
    FFMPEG,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src,
      '-vf', `scale=${MAX_W}:-1:flags=lanczos`,
      '-q:v', '4',
      dest
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

console.log('\n================ 表情包入库 ================\n')

if (!fs.existsSync(SRC_ROOT)) {
  console.error('找不到素材目录：' + SRC_ROOT)
  process.exit(1)
}

ensureDir(OUT_ROOT)

const roleDirs = fs.readdirSync(SRC_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory())
let totalFiles = 0
let totalBytes = 0

for (const rd of roleDirs) {
  const roleId = ROLE_MAP[rd.name]
  if (!roleId) {
    console.log(`  跳过未知角色目录：${rd.name}`)
    continue
  }

  const srcDir = path.join(SRC_ROOT, rd.name)
  const outDir = path.join(OUT_ROOT, roleId)
  ensureDir(outDir)

  const files = fs
    .readdirSync(srcDir)
    .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
    .sort()

  const entries = []
  let i = 0
  let okCount = 0

  for (const f of files) {
    i++
    const src = path.join(srcDir, f)
    const id = `st_${roleId}_${String(i).padStart(3, '0')}`
    const outName = `${id}.jpg`
    const dest = path.join(outDir, outName)

    try {
      convert(src, dest)
      const size = fs.statSync(dest).size
      totalBytes += size
      okCount++
      entries.push({
        id,
        file: outName,
        tags: [],
        mood: '',
        source: 'local',
        originalName: f
      })
    } catch (e) {
      console.log(`    ✗ ${f} 转换失败`)
    }
  }

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify(
      {
        characterId: roleId,
        roleName: rd.name,
        count: entries.length,
        updatedAt: new Date().toISOString(),
        stickers: entries
      },
      null,
      2
    ),
    'utf-8'
  )

  totalFiles += okCount
  const mb = (entries.reduce((a, e) => a + fs.statSync(path.join(outDir, e.file)).size, 0) / 1024 / 1024).toFixed(1)
  console.log(`  ✓ ${rd.name} → ${roleId}/   ${okCount} 张   ${mb} MB`)
}

console.log(`\n  合计 ${totalFiles} 张，${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`  输出：${OUT_ROOT}\n`)
