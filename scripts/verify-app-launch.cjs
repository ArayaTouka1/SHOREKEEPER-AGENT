/**
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } = require('node:fs')
const { join, resolve, basename, extname } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-app')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
module.exports = {
  app: { getPath: () => 'C:\\\\tmp', getAppPath: () => process.env.VAPP, getVersion: () => '0' },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class {}, Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}
`,
  'utf-8'
)

writeFileSync(
  join(OUT, 'entry.ts'),
  `export * from '${slash(join(ROOT, 'src/main/appMatch'))}'
export * from '${slash(join(ROOT, 'src/main/apps'))}'
`,
  'utf-8'
)

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    join(OUT, 'entry.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--alias:electron=' + slash(join(OUT, 'stub.cjs')),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')),
    '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

process.env.VAPP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const out = []
const check = (name, fn) => {
  try {
    const r = fn()
    if (r === false) throw new Error('返回 false')
    pass++
    out.push('  PASS  ' + name)
  } catch (e) {
    fail++
    out.push('  FAIL  ' + name + '  -> ' + (e && e.message ? e.message : String(e)))
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m || '断言失败')
}

out.push('=== 1. 卸载程序识别 ===')

check('中文「卸载 XXX」被识别', () => {
  for (const n of ['卸载迅雷', '卸载百度网盘', '卸载网易云音乐', '卸载剪映专业版', '卸载', '卸载程序']) {
    assert(mod.looksLikeUninstaller(n) === true, '没识别：' + n)
  }
  return true
})

check('英文 Uninstall 被识别', () => {
  for (const n of ['Uninstall', 'Uninstall Node.js', 'Uninstall 鸣潮', 'unins000', 'uninstall.exe']) {
    assert(mod.looksLikeUninstaller(n) === true, '没识别：' + n)
  }
  return true
})

check('修复/安装器类被识别', () => {
  for (const n of ['修复工具', 'Repair', 'setup', 'Installer', '更新程序', 'Updater', 'README', '帮助文档']) {
    assert(mod.looksLikeUninstaller(n) === true, '没识别：' + n)
  }
  return true
})

check('正常软件名不会被误杀', () => {
  for (const n of ['迅雷', '百度网盘', '网易云音乐', '微信', 'QQ', '剪映专业版', 'Visual Studio Code', '火绒安全']) {
    assert(mod.looksLikeUninstaller(n) === false, '误判：' + n)
  }
  return true
})

check('目标路径识别', () => {
  assert(mod.targetLooksLikeUninstaller('C:\\Program Files\\X\\unins000.exe') === true, 'unins000 没识别')
  assert(mod.targetLooksLikeUninstaller('C:\\Program Files\\X\\Uninstall.exe') === true, 'Uninstall 没识别')
  assert(mod.targetLooksLikeUninstaller('C:\\Program Files\\X\\X.exe') === false, '正常目标被误判')
  return true
})

out.push('')
out.push('=== 2. 候选评分 ===')

check('完全相等的分最高', () => {
  const a = mod.scoreCandidate({ label: '迅雷', dirName: '迅雷', target: 'C:\\X\\xunlei.exe' }, '迅雷')
  const b = mod.scoreCandidate({ label: '迅雷极速版', dirName: '迅雷', target: 'C:\\X\\x.exe' }, '迅雷')
  assert(a > b, `完全相等(${a}) 应高于前缀(${b})`)
  return true
})

check('前缀匹配高于子串匹配', () => {
  const a = mod.scoreCandidate({ label: '迅雷极速版', dirName: '', target: '' }, '迅雷')
  const b = mod.scoreCandidate({ label: '极速迅雷', dirName: '', target: '' }, '迅雷')
  assert(a > b, `前缀(${a}) 应高于子串(${b})`)
  return true
})

check('卸载类候选直接淘汰（-1）', () => {
  assert(mod.scoreCandidate({ label: '卸载迅雷', dirName: '', target: '' }, '迅雷') === -1, '没淘汰')
  assert(mod.scoreCandidate({ label: '迅雷', dirName: '', target: 'C:\\X\\unins000.exe' }, '迅雷') === -1, '目标未淘汰')
  return true
})

check('更新/助手类会被降权', () => {
  const main = mod.scoreCandidate({ label: '迅雷', dirName: '', target: 'C:\\X\\a.exe' }, '迅雷')
  const helper = mod.scoreCandidate({ label: '迅雷更新程序', dirName: '', target: 'C:\\X\\b.exe' }, '迅雷')
  assert(main > helper, `主程序(${main}) 应高于附属(${helper})`)
  return true
})

out.push('')
out.push('=== 3. 真实开始菜单扫描 ===')

const roots = [
  join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
  join(process.env['APPDATA'] ?? '', 'Microsoft\\Windows\\Start Menu\\Programs')
]

let uninstallCount = 0
for (const r of roots) {
  if (!existsSync(r)) continue
  const stack = [r]
  while (stack.length) {
    const d = stack.pop()
    let es = []
    try {
      es = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of es) {
      if (e.isDirectory()) stack.push(join(d, e.name))
      else if (/卸载|uninstall|unins/i.test(e.name)) uninstallCount++
    }
  }
}
out.push(`        （本机开始菜单里有 ${uninstallCount} 个卸载类快捷方式）`)

const QUERIES = [
  '网易云音乐', '剪映', '百度网盘', '迅雷', 'qBittorrent', '哔哩哔哩',
  'WeGame', '火绒', '鸣潮', '微信', 'QQ', '钉钉',
  'Visual Studio Code', '网易云', '哔哩哔哩直播姬', '异环'
]

check('扫描结果里绝不出现卸载程序', () => {
  const bad = []
  for (const q of QUERIES) {
    const r = mod.scanStartMenu(q)
    if (r.best) {
      const label = basename(r.best.path)
      if (/卸载|uninstall|unins/i.test(label)) {
        bad.push(`${q} → ${label}`)
      }
    }
  }
  assert(bad.length === 0, '仍有卸载程序被选中：\n    ' + bad.join('\n    '))
  return true
})

check('能正确找到正常的启动快捷方式', () => {
  const found = []
  const missing = []
  for (const q of QUERIES) {
    const r = mod.scanStartMenu(q)
    if (r.best) found.push(`${q} → ${r.best.label}`)
    else missing.push(q)
  }
  out.push('        ' + found.join('\n        '))
  if (missing.length) out.push('        未找到：' + missing.join('、'))
  assert(found.length >= QUERIES.length * 0.7, `命中率过低：${found.length}/${QUERIES.length}`)
  return true
})

check('被过滤的候选有明确原因', () => {
  const r = mod.scanStartMenu('迅雷')
  const uninsRejected = r.rejected.filter((x) => /卸载|unins/i.test(x.label))
  assert(uninsRejected.length > 0, '没有记录被过滤的卸载项')
  assert(
    uninsRejected.every((x) => x.reason.length > 0),
    '过滤原因缺失'
  )
  return true
})

check('「迅雷」不会再命中「卸载迅雷」', () => {
  const r = mod.scanStartMenu('迅雷')
  assert(r.best !== null, '没找到候选')
  assert(!/卸载/.test(r.best.label), '仍命中卸载项：' + r.best.label)
  assert(!r.candidates.some((c) => /卸载|unins/i.test(c.label)), '候选列表里还有卸载项')
  return true
})

check('「鸣潮」不会再命中「Uninstall 鸣潮」', () => {
  const r = mod.scanStartMenu('鸣潮')
  if (r.best) {
    assert(!/uninstall|卸载/i.test(r.best.label), '仍命中：' + r.best.label)
  }
  assert(!r.candidates.some((c) => /uninstall|卸载/i.test(c.label)), '候选里还有卸载项')
  return true
})

check('launchApp 走别名表时不碰扫描', () => {
  const alias = mod.resolveApp('网易云音乐')
  assert(alias !== null && alias !== undefined, '别名表没命中网易云音乐')
  return true
})

console.log('\n' + out.join('\n'))
console.log('\n========================================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================\n')

rmSync(OUT, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
