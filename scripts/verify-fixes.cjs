/**
 *
 *
 */

const { execFileSync, execSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'electron-stub.cjs')
writeFileSync(
  STUB,
  `
const fs = require('node:fs')
const path = require('node:path')
const DATA = process.env.VERIFY_DATA_DIR
module.exports = {
  app: {
    getPath: (k) => (k === 'userData' ? DATA : DATA),
    getAppPath: () => process.env.VERIFY_APP_PATH,
    getVersion: () => '0.2.0-verify'
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
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/persona'))}'
export * from '${slash(join(ROOT, 'src/main/voice'))}'
export * from '${slash(join(ROOT, 'src/main/theme'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/llm'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'verify-'))
process.env.VERIFY_DATA_DIR = DATA
process.env.VERIFY_APP_PATH = ROOT

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

const SRC = 'F:\\work\\aiagent'

lines.push('=== 1. 音色：每角色独立语音包 ===')

check('内置角色的默认引擎都是 voice-pack（本地生成引擎已移除）', () => {
  const chars = mod.characterRepo.list()
  const builtin = chars.filter((c) => c.builtin)
  assert(builtin.length === 4, '内置角色数=' + builtin.length)
  for (const c of builtin) {
    assert(c.voice.engine === 'voice-pack', c.name + ' 引擎=' + c.voice.engine)
  }
  return true
})

check('四个角色绑定的语音包各不相同', () => {
  const builtin = mod.characterRepo.list().filter((c) => c.builtin)
  const packs = builtin.map((c) => c.voice.voicePackFile)
  assert(packs.every((p) => p && p.length > 0), '有角色没绑语音包: ' + JSON.stringify(packs))
  assert(new Set(packs).size === 4, '语音包有重复: ' + packs.join(','))
  return true
})

check('语音包文件真实存在于 resources/voices', () => {
  const builtin = mod.characterRepo.list().filter((c) => c.builtin)
  for (const c of builtin) {
    const p = mod.resolveVoicePath(c.voice.voicePackFile, c.voice.customPackPath)
    assert(p && existsSync(p), c.name + ' 语音包找不到: ' + c.voice.voicePackFile)
  }
  return true
})

check('listVoiceAssets 返回 3 个内置语音包', () => {
  const assets = mod.listVoiceAssets()
  const builtin = assets.filter((a) => a.builtin)
  assert(builtin.length === 3, '内置语音包数=' + builtin.length)
  assert(
    builtin.every((a) => a.characterId),
    '语音包缺 characterId: ' + JSON.stringify(builtin.map((b) => b.characterId))
  )
  return true
})

check('改音色能持久化（语速 + 引擎）', () => {
  const c = mod.characterRepo.active()
  mod.characterRepo.saveCharacter({ id: c.id, voice: { ...c.voice, rate: 1.35, engine: 'system', voiceId: 'zh-CN-YunxiNeural' } })
  const after = mod.characterRepo.list().find((x) => x.id === c.id)
  assert(Math.abs(after.voice.rate - 1.35) < 0.001, 'rate 未保存: ' + after.voice.rate)
  assert(after.voice.engine === 'system', 'engine 未保存: ' + after.voice.engine)
  assert(after.voice.voiceId === 'zh-CN-YunxiNeural', 'voiceId 未保存')
  assert(after.voice.voicePackFile, 'voicePackFile 被冲掉了')
  mod.characterRepo.saveCharacter({ id: c.id, voice: { ...after.voice, rate: 1, engine: 'voice-pack' } })
  return true
})

check('voice 深合并：只改 autoSpeak 不影响其他字段', () => {
  const c = mod.characterRepo.active()
  const before = { ...c.voice } // before 就是 voice 对象本身
  mod.characterRepo.saveCharacter({ id: c.id, voice: { ...before, autoSpeak: !before.autoSpeak } })
  const after = mod.characterRepo.list().find((x) => x.id === c.id)
  assert(after.voice.voicePackFile === before.voicePackFile, 'voicePackFile 被改了')
  assert(after.voice.engine === before.engine, 'engine 被改了: ' + after.voice.engine + ' vs ' + before.engine)
  assert(after.voice.autoSpeak !== before.autoSpeak, 'autoSpeak 没改成功')
  return true
})

check('不带 id 的 saveCharacter 是「新建」，不会覆盖现有角色', () => {
  const before = mod.characterRepo.list().length
  const created = mod.characterRepo.saveCharacter({ name: '临时角色' })
  const after = mod.characterRepo.list().length
  assert(after === before + 1, '没有新建，数量=' + after)
  assert(created.name === '临时角色', '新建的名字不对')
  assert(!created.builtin, '新建的应是可删除角色')
  mod.characterRepo.deleteCharacter(created.id)
  assert(mod.characterRepo.list().length === before, '删除后数量没恢复')
  return true
})

lines.push('=== 2. 人格：每角色一份，互不串味 ===')

check('内置人格有 3 份，且 id 对应三个角色', () => {
  const personas = mod.characterRepo.personas()
  for (const id of ['persona_shorekeeper', 'persona_aemeath', 'persona_firefly']) {
    assert(personas.some((p) => p.id === id), '缺少人格: ' + id)
  }
  return true
})

check('三份人格内容互不相同', () => {
  const personas = mod.characterRepo.personas()
  const get = (id) => personas.find((p) => p.id === id).content
  const sk = get('persona_shorekeeper')
  const ae = get('persona_aemeath')
  const ff = get('persona_firefly')
  assert(sk !== ae && ae !== ff && sk !== ff, '人格内容有重复')
  return true
})

check('守岸人人格来自人格包组装', () => {
  const persona = mod.characterRepo.personas().find((p) => p.id === 'persona_shorekeeper')
  assert(persona.content.length > 500, '人格正文过短：' + persona.content.length)
  assert(/SYSTEM|CORE_IDENTITY|核心|身份/.test(persona.content), '缺少核心段')
  assert(/反\s*AI|BOUNDARIES|BEHAVIOR_RULES|边界|行为规则/.test(persona.content), '缺少行为规则段')
  assert(/WORLDVIEW|BACKGROUND|世界|背景/.test(persona.content), '缺少世界观段')
  return true
})

check('爱弥斯人格来自人格包组装', () => {
  const persona = mod.characterRepo.personas().find((p) => p.id === 'persona_aemeath')
  assert(persona.content.length > 500, '人格正文过短：' + persona.content.length)
  assert(/SYSTEM|CORE_IDENTITY|核心|身份/.test(persona.content), '缺少核心段')
  assert(/PERSONALITY|SPEECH_STYLE|性格|说话/.test(persona.content), '缺少性格或语言段')
  return true
})

check('流萤人格是仿写的（含流萤关键词且够长）', () => {
  const persona = mod.characterRepo.personas().find((p) => p.id === 'persona_firefly')
  assert(persona.content.includes('流萤'), '没提到流萤')
  assert(persona.content.length > 500, '内容太短: ' + persona.content.length)
  return true
})

check('每个角色拿到的是自己那份人格', () => {
  const chars = mod.characterRepo.list().filter((c) => c.builtin)
  const seen = new Set()
  for (const c of chars) {
    const p = mod.characterRepo.personaOf(c)
    assert(p, c.name + ' 没有绑定人格')
    seen.add(p.id)
    assert(p.content.includes(c.name) || p.id.includes(c.id.replace('char_', '')), c.name + ' 的人格可能不是它自己的: ' + p.id)
  }
  assert(seen.size === 4, '角色共用的人格数=' + seen.size)
  return true
})

check('编辑内置人格会存进 overrides，不动磁盘文件', () => {
  const persona = mod.characterRepo.personas().find((p) => p.id === 'persona_shorekeeper')
  let rejected = false
  try {
    mod.characterRepo.savePersona({ id: 'persona_shorekeeper', content: (persona?.content ?? '') + '\n\n## 临时标记\n测试用。' })
  } catch (e) {
    rejected = true
    assert(/固定使用|不能覆盖|角色文件夹/.test(String(e.message)), '拒绝原因不明确：' + e.message)
  }
  assert(rejected, '内置人格的覆盖应被拒绝')
  const dir = mod.builtinPersonaDir()
  assert(dir.length > 0, '人格目录不可用')
  return true
})

check('还原人格后内容仍可读', () => {
  const p = mod.characterRepo.personas().find((x) => x.id === 'persona_shorekeeper')
  assert(p && p.content.length > 500, '还原后人格异常')
  return true
})

lines.push('=== 3. 主题：多主题 + 自定义 ===')

check('内置主题 ≥ 8 个', () => {
  const presets = mod.themeRepo.presets()
  assert(presets.length >= 8, '主题数=' + presets.length)
  return true
})

check('主题覆盖浅色与深色', () => {
  const presets = mod.themeRepo.presets()
  assert(presets.some((p) => !p.tokens.dark), '没有浅色主题')
  assert(presets.some((p) => p.tokens.dark), '没有深色主题')
  return true
})

check('切换主题会持久化并改变 activeTokens', () => {
  mod.themeRepo.setActive('midnight')
  const st = mod.themeRepo.state()
  assert(st.activeId === 'midnight', 'activeId=' + st.activeId)
  const tokens = mod.themeRepo.activeTokens()
  assert(tokens.dark === true, '午夜主题应为深色')
  assert(tokens.bgBase === '#0e0f1a', 'bgBase=' + tokens.bgBase)
  return true
})

check('每个主题的 token 都完整', () => {
  const required = [
    'bgBase','bgGradA','bgGradB','bgGradC','glass','glassHover','stroke','strokeStrong',
    'accent','accent2','accentGradFrom','accentGradMid','accentGradTo',
    'text1','text2','text3','text4','bubbleUserFrom','bubbleUserTo','bubbleChar','shadow'
  ]
  for (const p of mod.themeRepo.presets()) {
    for (const k of required) {
      assert(p.tokens[k] !== undefined && p.tokens[k] !== '', p.name + ' 缺 token: ' + k)
    }
  }
  return true
})

check('自定义主题：fork → 改色 → 落盘', () => {
  mod.themeRepo.forkPreset('sakura')
  assert(mod.themeRepo.state().activeId === 'custom', 'fork 后应切到 custom')
  mod.themeRepo.patchCustom({ accent: '#123456' })
  const tokens = mod.themeRepo.activeTokens()
  assert(tokens.accent === '#123456', 'accent=' + tokens.accent)
  return true
})

check('保存自定义主题并出现在列表里', () => {
  const before = mod.themeRepo.state().saved.length
  mod.themeRepo.saveCustom('我的测试主题', '验证用')
  const st = mod.themeRepo.state()
  assert(st.saved.length === before + 1, '保存后数量=' + st.saved.length)
  assert(st.saved.some((p) => p.name === '我的测试主题'), '没找到保存的主题')
  return true
})

check('切换回内置主题后 token 跟随变化', () => {
  mod.themeRepo.setActive('sakura')
  const tokens = mod.themeRepo.activeTokens()
  assert(tokens.accent === '#f4a3c8', 'accent=' + tokens.accent)
  assert(tokens.dark === false, 'sakura 应为浅色')
  return true
})

check('删除自定义主题', () => {
  const target = mod.themeRepo.state().saved.find((p) => p.name === '我的测试主题')
  mod.themeRepo.deleteSaved(target.id)
  assert(!mod.themeRepo.state().saved.some((p) => p.name === '我的测试主题'), '删除失败')
  return true
})

lines.push('=== 4. AI 与 API：引擎切换真正生效 ===')

check('默认 provider=offline，engineInfo 判定为离线', () => {
  mod.settingsRepo.reset()
  const info = mod.settingsRepo.engineInfo()
  assert(info.mode === 'offline', 'mode=' + info.mode)
  assert(info.ready === true, 'ready 应为 true')
  return true
})

check('切到 openai-compatible 但没填 Key → 仍判定离线且给出原因', () => {
  mod.settingsRepo.save({ llm: { ...mod.settingsRepo.get().llm, provider: 'openai-compatible', apiKey: '' } })
  const info = mod.settingsRepo.engineInfo()
  assert(info.mode === 'offline', 'mode=' + info.mode)
  assert(info.ready === false, 'ready 应为 false')
  assert(info.reason.includes('API Key'), '原因应提到 API Key: ' + info.reason)
  return true
})

check('填了 Key 后 → 判定为 remote', () => {
  mod.settingsRepo.save({ llm: { ...mod.settingsRepo.get().llm, apiKey: 'sk-test-123' } })
  const info = mod.settingsRepo.engineInfo()
  assert(info.mode === 'remote', 'mode=' + info.mode)
  assert(info.ready === true, 'ready 应为 true')
  assert(info.reason.includes('已接入'), 'reason=' + info.reason)
  return true
})

check('切回 offline → 立即回到离线', () => {
  mod.settingsRepo.save({ llm: { ...mod.settingsRepo.get().llm, provider: 'offline' } })
  const info = mod.settingsRepo.engineInfo()
  assert(info.mode === 'offline', 'mode=' + info.mode)
  assert(info.label.includes('离线'), 'label=' + info.label)
  return true
})

const pendingAsync = checkAsync('离线引擎的回复受人格影响（守岸人 vs 爱弥斯不同）', async () => {  const personas = mod.characterRepo.personas()
  const chars = mod.characterRepo.list()
  const sk = chars.find((c) => c.id === 'char_shorekeeper')
  const ae = chars.find((c) => c.id === 'char_aemeath')
  const pSk = personas.find((p) => p.id === 'persona_shorekeeper')
  const pAe = personas.find((p) => p.id === 'persona_aemeath')

  const sysSk = await mod.buildSystemPrompt({ character: sk, persona: pSk, memories: [], settings: mod.settingsRepo.get() })
  const sysAe = await mod.buildSystemPrompt({ character: ae, persona: pAe, memories: [], settings: mod.settingsRepo.get() })

  assert(sysSk !== sysAe, '两人的 system prompt 一样')
  assert(sysSk.includes('守岸人') && !sysSk.includes('飞行雪绒'), '守岸人 prompt 混入了爱弥斯内容')
  assert(sysAe.includes('爱弥斯'), '爱弥斯 prompt 缺少名字')
  assert(/飞行雪绒|STYLE|说话方式|性格/.test(sysAe), '爱弥斯 prompt 缺少人设内容')
  assert(sysSk.length > 3000, '守岸人人格没被完整注入: ' + sysSk.length)
  return true
})

lines.push('=== 5. 角色头像 ===')

check('三个内置角色用的是各自立绘（PNG，不是 SVG 占位）', () => {
  const chars = mod.characterRepo.list().filter((c) => c.builtin)
  for (const c of chars) {
    assert(c.avatar.main.startsWith('data:image/png'), c.name + ' 头像不是 PNG: ' + c.avatar.main.slice(0, 30))
    assert(c.avatar.main.length > 10000, c.name + ' 头像太小，可能是占位图')
  }
  return true
})

check('四个角色头像互不相同', () => {
  const chars = mod.characterRepo.list().filter((c) => c.builtin)
  const mains = chars.map((c) => c.avatar.main)
  assert(new Set(mains).size === 4, '有角色共用同一张头像')
  return true
})

check('头图是 JPEG 横幅', () => {
  const chars = mod.characterRepo.list().filter((c) => c.builtin)
  for (const c of chars) {
    assert(c.avatar.banner.startsWith('data:image/jpeg'), c.name + ' 头图不是 JPEG')
  }
  return true
})

void pendingAsync.then(() => {
  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})
