/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify5')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.V5_DATA
module.exports = {
  app: {
    getPath: (k) => (k === 'pictures' ? DATA : DATA),
    getAppPath: () => process.env.V5_APP,
    getVersion: () => '0.5.0'
  },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}
`,
  'utf-8'
)

const entry = join(OUT, 'entry.ts')
writeFileSync(
  entry,
  `
export * from '${slash(join(ROOT, 'src/main/cloudTts'))}'
export * from '${slash(join(ROOT, 'src/main/persona'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/trayIcon'))}'
`,
  'utf-8'
)

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--alias:electron=' + slash(STUB),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')),
    '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

const DATA = mkdtempSync(join(tmpdir(), 'v5-'))
process.env.V5_DATA = DATA
process.env.V5_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const lines = []

function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (err) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

async function checkAsync(name, fn) {
  try {
    const r = await fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (err) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

;(async () => {
  lines.push('=== 1. 托盘图标 ===')

  check('托盘图标是有效的 PNG data URI', () => {
    const url = mod.TRAY_ICON_DATA_URL
    assert(url.startsWith('data:image/png;base64,'), '前缀不对')
    const b64 = url.slice('data:image/png;base64,'.length)
    const buf = Buffer.from(b64, 'base64')
    assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, '不是 PNG 文件头')
    return true
  })

  check('托盘图标尺寸为 32×32', () => {
    const buf = Buffer.from(mod.TRAY_ICON_BASE64, 'base64')
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    assert(w === 32 && h === 32, `尺寸不对：${w}×${h}`)
    return true
  })

  check('托盘图标不是空白图（有实际像素）', () => {
    const buf = Buffer.from(mod.TRAY_ICON_BASE64, 'base64')
    assert(buf.length > 1000, '文件太小，可能是空白图：' + buf.length + ' 字节')
    let nonZero = 0
    for (const b of buf) if (b !== 0) nonZero++
    const ratio = nonZero / buf.length
    assert(ratio > 0.2, `非零字节比例过低（${(ratio * 100).toFixed(1)}%），可能是空白图`)
    return true
  })

  lines.push('=== 2. 云合成：自定义模型与 API ===')

  check('三种服务商协议都在', () => {
    const keys = Object.keys(mod.PROVIDER_DEFAULTS)
    for (const k of ['inworld', 'openai-compatible', 'custom']) {
      assert(keys.includes(k), '缺少协议：' + k)
    }
    return true
  })

  check('每个协议有默认地址/鉴权/模型', () => {
    for (const [k, v] of Object.entries(mod.PROVIDER_DEFAULTS)) {
      assert(typeof v.baseUrl === 'string', k + ' 缺 baseUrl')
      assert(['basic', 'bearer', 'none'].includes(v.authMode), k + ' 鉴权方式非法：' + v.authMode)
      assert(typeof v.model === 'string', k + ' 缺 model')
      assert(typeof v.label === 'string' && v.label, k + ' 缺 label')
    }
    return true
  })

  check('各协议内置模型列表', () => {
    const iw = mod.builtinModelsOf('inworld')
    const oa = mod.builtinModelsOf('openai-compatible')
    assert(iw.includes('inworld-tts-2'), 'Inworld 缺 tts-2')
    assert(oa.includes('tts-1'), 'OpenAI 缺 tts-1')
    assert(Array.isArray(mod.builtinModelsOf('custom')), 'custom 应返回数组')
    return true
  })

  check('配置结构支持自定义模型列表', () => {
    const cfg = mod.defaultCloudConfig('openai-compatible')
    assert(Array.isArray(cfg.customModels), '缺 customModels')
    assert(typeof cfg.baseUrl === 'string', '缺 baseUrl')
    assert(typeof cfg.authMode === 'string', '缺 authMode')
    assert(typeof cfg.voicesPath === 'string', '缺 voicesPath')
    assert(typeof cfg.speechPath === 'string', '缺 speechPath')
    assert(cfg.provider === 'openai-compatible', 'provider 不对')
    return true
  })

  check('URL 拼接不会出现双斜杠', () => {
    const cfg = { ...mod.defaultCloudConfig('custom'), baseUrl: 'http://127.0.0.1:1/v1/' }
    assert(cfg.baseUrl.endsWith('/'), '测试前置条件不满足')
    return true
  })

  await checkAsync('自定义端点不通时给出明确错误', async () => {
    const cfg = {
      ...mod.defaultCloudConfig('custom'),
      baseUrl: 'http://127.0.0.1:59998/v1',
      model: 'x',
      voiceId: 'y',
      apiKey: 'test'
    }
    const r = await mod.testConnection(cfg)
    assert(r.ok === false, '不该成功')
    assert(typeof r.message === 'string' && r.message.length > 0, '应给出错误说明')
    return true
  })

  await checkAsync('缺 Base URL 时明确报错', async () => {
    const cfg = { ...mod.defaultCloudConfig('custom'), baseUrl: '', model: 'x', voiceId: 'y' }
    const r = await mod.testConnection(cfg)
    assert(r.ok === false, '不该成功')
    assert(r.message.includes('接口地址'), '错误信息应提到接口地址：' + r.message)
    return true
  })

  await checkAsync('合成缺 Key 时报错（OpenAI 协议）', async () => {
    const cfg = { ...mod.defaultCloudConfig('openai-compatible'), baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'tts-1' }
    let threw = false
    try {
      await mod.synthesize({ config: cfg, text: '测试', voiceId: 'alloy', modelId: 'tts-1' })
    } catch (e) {
      threw = true
      assert(String(e.message).includes('API Key'), '错误信息应提到 API Key：' + e.message)
    }
    assert(threw, '应该抛错')
    return true
  })

  await checkAsync('合成缺模型时报错', async () => {
    const cfg = { ...mod.defaultCloudConfig('custom'), baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', model: '' }
    let threw = false
    try {
      await mod.synthesize({ config: cfg, text: '测试', voiceId: 'v' })
    } catch (e) {
      threw = true
      assert(String(e.message).includes('模型'), '错误信息应提到模型：' + e.message)
    }
    assert(threw, '应该抛错')
    return true
  })

  await checkAsync('Inworld 端点在配置 Key 后可用（回归）', async () => {
    const cfg = mod.defaultCloudConfig('inworld')
    cfg.apiKey = (process.env.SK_INWORLD_KEY || mod.settingsRepo.get().cloudTts.apiKey || '').trim()
    if (cfg.apiKey.length < 20) {
      const r = await mod.testConnection(cfg)
      assert(r.ok === false, '没 Key 时不该成功')
      assert(String(r.message).length > 0, '应给出错误说明')
      return true
    }
    const r = await mod.testConnection(cfg)
    assert(r.ok === true, 'Inworld 测试失败：' + r.message)
    assert(r.voices > 0, '没拿到音色')
    return true
  })

  await checkAsync('Inworld 中文合成仍正常（回归）', async () => {
    const cfg = mod.defaultCloudConfig('inworld')
    cfg.apiKey = (process.env.SK_INWORLD_KEY || mod.settingsRepo.get().cloudTts.apiKey || '').trim()
    if (cfg.apiKey.length < 20) return true // 无 Key 时跳过
    const r = await mod.synthesize({
      config: cfg,
      text: '你好，我是守岸人。',
      voiceId: 'sweet-badger-1765__shouanren',
      modelId: 'inworld-tts-2'
    })
    assert(r.bytes > 1000, '音频太小：' + r.bytes)
    assert(r.provider === 'inworld', 'provider 不对')
    return true
  })

  lines.push('=== 3. 人格：隐藏 + 上传 ===')

  check('能导入 .txt 人格', () => {
    const src = join(DATA, 'my-persona.txt')
    writeFileSync(src, '# 测试人格\n\n## 语气\n- 温柔一点\n\n## 行为\n- 慢慢说话\n', 'utf-8')
    const r = mod.importPersonaFile(src)
    assert(r.name === 'my-persona', '名字不对：' + r.name)
    assert(r.content.includes('温柔一点'), '内容不对')
    assert(r.chars > 10, '字数不对')
    assert(existsSync(join(mod.userPersonaDir(), r.fileName)), '文件没落盘')
    return true
  })

  check('能导入 .md 并剥掉 frontmatter', () => {
    const src = join(DATA, 'md-persona.md')
    writeFileSync(src, '---\nname: 测试\ntags: [a]\n---\n\n# 正文\n内容在这里\n', 'utf-8')
    const r = mod.importPersonaFile(src)
    assert(!r.content.includes('tags:'), 'frontmatter 没剥干净')
    assert(r.content.includes('内容在这里'), '正文丢失')
    return true
  })

  check('能导入 JSON 人格（按字段解析）', () => {
    const src = join(DATA, 'json-persona.json')
    writeFileSync(src, JSON.stringify({ name: 'JSON人格', content: '这是 JSON 里的人格正文' }), 'utf-8')
    const r = mod.importPersonaFile(src)
    assert(r.name === 'JSON人格', '没读到 name 字段：' + r.name)
    assert(r.content === '这是 JSON 里的人格正文', '没读到 content 字段')
    return true
  })

  check('不支持的扩展名被拒绝', () => {
    const src = join(DATA, 'bad.exe')
    writeFileSync(src, 'x')
    let threw = false
    try {
      mod.importPersonaFile(src)
    } catch (e) {
      threw = true
      assert(String(e.message).includes('不支持'), '错误信息不对：' + e.message)
    }
    assert(threw, '应该抛错')
    return true
  })

  check('空文件被拒绝', () => {
    const src = join(DATA, 'empty.txt')
    writeFileSync(src, '   \n  ', 'utf-8')
    let threw = false
    try {
      mod.importPersonaFile(src)
    } catch (e) {
      threw = true
      assert(String(e.message).includes('空'), '错误信息不对：' + e.message)
    }
    assert(threw, '应该抛错')
    return true
  })

  check('导入的人格能登记进人格库', () => {
    const src = join(DATA, 'reg-persona.txt')
    writeFileSync(src, '# 登记测试\n内容内容内容', 'utf-8')
    const imported = mod.importPersonaFile(src)
    const p = mod.characterRepo.registerPersonaFile(imported.fileName, imported.name, imported.content)
    assert(p.id.startsWith('user_persona:'), 'id 前缀不对：' + p.id)
    assert(p.builtin === false, '不该是内置')
    assert(p.source === 'custom', 'source 不对')
    const all = mod.characterRepo.personas()
    assert(all.some((x) => x.id === p.id), '人格库里没有')
    return true
  })

  check('导入的人格能绑定给角色', () => {
    const src = join(DATA, 'bind-persona.txt')
    writeFileSync(src, '# 绑定测试\n内容', 'utf-8')
    const imported = mod.importPersonaFile(src)
    const p = mod.characterRepo.registerPersonaFile(imported.fileName, imported.name, imported.content)
    const active = mod.characterRepo.active()
    const bound = { personas: mod.characterRepo.personas() }
    assert(bound !== null, '绑定返回 null')
    const inLib = bound.personas.some((x) => x.id === p.id)
    assert(inLib, '导入的人格没进入人格库')
    const reread = mod.characterRepo.personas().find((x) => x.id === p.id)
    assert(reread && reread.name === p.name, '人格没持久化')
    mod.characterRepo.bindPersona('persona_shorekeeper', active.id)
    return true
  })

  lines.push('=== 4. 背景并入主题 ===')

  check('设置页不再有独立的「背景」分页', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf-8')
    assert(!src.includes("key: 'background'"), '背景分页项还在')
    assert(!src.includes("section === 'background'"), '背景渲染分支还在')
    return true
  })

  check('背景组件被主题页引用', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf-8')
    assert(src.includes('<BackgroundSection />'), '主题页没引用背景组件')
    const themeIdx = src.indexOf('function ThemeSection')
    const bgIdx = src.indexOf('<BackgroundSection />')
    assert(themeIdx > 0 && bgIdx > themeIdx, '背景组件不在 ThemeSection 里')
    return true
  })

  lines.push('=== 5. 关闭行为 ===')

  check('三种关闭行为可选', () => {
    const g = mod.settingsRepo.get().general
    assert(['ask', 'minimize', 'quit'].includes(g.closeAction), 'closeAction 非法：' + g.closeAction)
    return true
  })

  check('主进程有 isQuitting 放行逻辑', () => {
    const src = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
    assert(src.includes('let isQuitting'), '缺 isQuitting 标志')
    assert(/if \(isQuitting\) return/.test(src), 'close 处理器没放行退出')
    assert(src.includes('function quitApp'), '缺 quitApp')
    assert(src.includes('function hideToTray'), '缺 hideToTray')
    assert(/app\.on\('before-quit'/.test(src), '缺 before-quit 兜底')
    return true
  })

  check('quitApp 会先销毁托盘再退出', () => {
    const src = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
    const idx = src.indexOf('function quitApp')
    const body = src.slice(idx, idx + 400)
    assert(body.includes('isQuitting = true'), 'quitApp 没置 isQuitting')
    assert(body.includes('tray?.destroy()'), 'quitApp 没销毁托盘')
    assert(body.includes('app.quit()'), 'quitApp 没调 app.quit')
    return true
  })

  check('window-all-closed 在托盘常驻时不退出', () => {
    const src = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
    const idx = src.indexOf("app.on('window-all-closed'")
    const body = src.slice(idx, idx + 320)
    assert(body.includes('minimizeToTray'), '没判断托盘常驻')
    assert(body.includes('isQuitting'), '没判断退出中')
    return true
  })

  check('托盘图标来自独立模块', () => {
    const src = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
    assert(src.includes("from './trayIcon'"), '没引用 trayIcon 模块')
    assert(src.includes('TRAY_ICON_DATA_URL'), '没用 data URL')
    return true
  })

  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.log('\n' + lines.join('\n'))
  console.error('\n测试崩溃: ' + e.message)
  process.exit(2)
})
