/**
 *
 *   release/
 *
 */

const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readdirSync, renameSync, statSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const RELEASE = join(ROOT, 'release')
const INSTALLER_DIR = join(RELEASE, 'installer')
const PORTABLE_DIR = join(RELEASE, 'portable')

const onlyDir = process.argv.includes('--dir')

/* ------------------------------------------------------------------ *
 *
 * ------------------------------------------------------------------ */

function newestMtime(dir, filter) {
  let newest = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries = []
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (filter && !filter(e.name)) continue
      try {
        const t = statSync(full).mtimeMs
        if (t > newest) newest = t
      } catch {
        /* ignore */
      }
    }
  }
  return newest
}

console.log('▶ 检查构建新鲜度…')

const srcTime = newestMtime(join(ROOT, 'src'), (n) => /\.(ts|tsx)$/.test(n))
const outMain = join(ROOT, 'out', 'main', 'index.js')
const outRenderer = join(ROOT, 'out', 'renderer', 'index.html')

if (!existsSync(outMain)) {
  console.error('✗ 找不到 out/main/index.js —— 请先运行 npm run build')
  process.exit(1)
}

const outTime = Math.min(
  statSync(outMain).mtimeMs,
  existsSync(outRenderer) ? statSync(outRenderer).mtimeMs : statSync(outMain).mtimeMs
)

const fmt = (t) => new Date(t).toLocaleString('zh-CN')

if (srcTime > outTime + 1000) {
  console.error('\n✗ 构建产物已过期！')
  console.error(`   最新源码: ${fmt(srcTime)}`)
  console.error(`   构建产物: ${fmt(outTime)}`)
  console.error('\n  直接打包会把旧代码打进安装包。请先执行：')
  console.error('    npm run build\n')
  process.exit(1)
}

console.log(`  ✓ 构建是最新的（源码 ${fmt(srcTime)}）\n`)

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

console.log('▶ 开始打包…\n')

const args = ['--win']
if (onlyDir) args.push('--dir')

const builderBin = join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
if (!existsSync(builderBin)) {
  console.error('找不到 electron-builder，请先 npm install')
  process.exit(1)
}

execFileSync(process.execPath, [builderBin, ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
})

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function moveBy(files, dest, predicate) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  let moved = 0
  for (const f of files) {
    const full = join(RELEASE, f)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    if (!predicate(f)) continue
    const target = join(dest, f)
    if (existsSync(target)) rmSync(target, { force: true })
    renameSync(full, target)
    moved++
  }
  return moved
}

const entries = existsSync(RELEASE) ? readdirSync(RELEASE) : []

const installerMoved = moveBy(entries, INSTALLER_DIR, (f) => /-setup\.exe(\.blockmap)?$/i.test(f))
const portableMoved = moveBy(entries, PORTABLE_DIR, (f) => /-portable\.exe$/i.test(f))

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((f) => {
      const full = join(dir, f)
      const st = statSync(full)
      return st.isFile() ? { name: f, mb: (st.size / 1024 / 1024).toFixed(1) } : null
    })
    .filter(Boolean)
}

const summary = {
  installer: listFiles(INSTALLER_DIR),
  portable: listFiles(PORTABLE_DIR),
  unpacked: existsSync(join(RELEASE, 'win-unpacked')) ? 'release/win-unpacked/' : null
}

console.log('\n▶ 产物整理完成\n')
console.log('release/')
console.log('├── installer/')
if (summary.installer.length) {
  for (const f of summary.installer) console.log(`│   └── ${f.name}   ${f.mb} MB`)
} else {
  console.log('│   └── （无）')
}
console.log('├── portable/')
if (summary.portable.length) {
  for (const f of summary.portable) console.log(`│   └── ${f.name}   ${f.mb} MB`)
} else {
  console.log('│   └── （无）')
}
console.log('└── win-unpacked/    （调试用目录）\n')

console.log(`安装包 ${installerMoved} 个 · 便携版 ${portableMoved} 个\n`)
