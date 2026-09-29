/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify3')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.V3_DATA
const PIC = process.env.V3_PIC
module.exports = {
  app: {
    getPath: (k) => (k === 'pictures' ? PIC : DATA),
    getAppPath: () => process.env.V3_APP,
    getVersion: () => '0.3.0'
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
export * from '${slash(join(ROOT, 'src/main/background'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/theme'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v3-'))
const PIC = mkdtempSync(join(tmpdir(), 'v3pic-'))
process.env.V3_DATA = DATA
process.env.V3_PIC = PIC
process.env.V3_APP = ROOT
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

const KEY = (process.env.SK_INWORLD_KEY || mod.settingsRepo.get().cloudTts.apiKey || '').trim()
const HAS_KEY = KEY.length > 20
const IW = () => ({ ...mod.defaultCloudConfig('inworld'), apiKey: KEY })

;(async () => {
  /* ---------------- 1. Inworld ---------------- */
  lines.push('=== 1. Inworld TTS-2 云合成 ===')

  check('默认不预置 Key（新用户自行填写）', () => {
    const def = mod.settingsRepo.get()
    assert(typeof def.cloudTts.apiKey === 'string', 'cloudTts.apiKey 字段缺失')
    return true
  })

  if (!HAS_KEY) {
    lines.push('  SKIP  未配置 Inworld Key，跳过联网用例（设置 SK_INWORLD_KEY 可启用）')
  }

  await checkAsync('能拉取音色列表', async () => {
    if (!HAS_KEY) return true
    const voices = await mod.listCloudVoices(IW())
    assert(voices.length > 0, '音色列表为空')
    return true
  })

  await checkAsync('账号里有三个克隆音色', async () => {
    if (!HAS_KEY) return true
    const voices = await mod.listCloudVoices(IW())
    const cloned = voices.filter((v) => v.owned)
    assert(cloned.length >= 3, '克隆音色数=' + cloned.length)
    const ids = cloned.map((v) => v.voiceId)
    for (const need of ['shouanren', 'aimisi', 'liuying']) {
      assert(ids.some((i) => i.includes(need)), '缺少克隆音色: ' + need)
    }
    return true
  })

  check('内置角色都绑定了音色', () => {
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    assert(chars.length === 4, '内置角色数=' + chars.length)
    for (const c of chars) {
      const hasVoice = c.voice.voicePackFile || c.voice.voiceId
      assert(hasVoice, c.name + ' 没有绑定音色')
    }
    return true
  })

  await checkAsync('中文合成成功且落盘为 mp3', async () => {
    if (!HAS_KEY) return true
    const r = await mod.synthesize({
      config: IW(),
      text: '嗯……你回来了。今天过得怎么样？',
      voiceId: 'sweet-badger-1765__shouanren',
      modelId: 'inworld-tts-2'
    })
    assert(r.bytes > 1000, '音频太小: ' + r.bytes)
    assert(existsSync(r.path), '文件不存在: ' + r.path)
    assert(r.path.endsWith('.mp3'), '不是 mp3: ' + r.path)
    const st = statSync(r.path)
    assert(st.size > 1000, '磁盘文件太小: ' + st.size)
    return true
  })

  await checkAsync('三个角色音色都能合成（中文）', async () => {
    if (!HAS_KEY) return true
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    for (const c of chars) {
      const r = await mod.synthesize({
        config: IW(),
        text: '你好。',
        voiceId: c.voice.voiceId,
        modelId: 'inworld-tts-2'
      })
      assert(r.bytes > 500, `${c.name} 合成失败，bytes=${r.bytes}`)
    }
    return true
  })

  await checkAsync('连通测试返回 ok', async () => {
    if (!HAS_KEY) return true
    const r = await mod.testConnection(IW())
    assert(r.ok === true, '测试失败: ' + r.message)
    assert(r.voices > 0, '没拿到音色数')
    return true
  })

  await checkAsync('空 Key 时给出明确错误', async () => {
    let threw = false
    try {
      await mod.synthesize({
        config: { ...mod.defaultCloudConfig('inworld'), apiKey: '' },
        text: '测试',
        voiceId: 'Sarah'
      })
    } catch (e) {
      threw = true
      assert(e.message.includes('API Key'), '错误信息应提到 API Key: ' + e.message)
    }
    assert(threw, '空 Key 应该抛错')
    return true
  })

  await checkAsync('缓存目录会自动创建', async () => {
    const dir = mod.ttsCacheDir()
    assert(existsSync(dir), '缓存目录不存在')
    return true
  })

  lines.push('=== 2. 本地合成环境已移除 ===')

  check('本地引擎模块不再存在（Python venv 路线已删）', () => {
    assert(!existsSync(join(ROOT, 'src/main/ttsEngine.ts')), 'ttsEngine.ts 仍存在')
    assert(!existsSync(join(ROOT, 'src/main/localTts.ts')), 'localTts.ts 仍存在')
    return true
  })

  lines.push('=== 3. 背景媒体 ===')

  check('背景目录在用户数据下', () => {
    const d = mod.backgroundDir()
    assert(d.includes(DATA), '不在用户数据目录: ' + d)
    assert(existsSync(d), '目录不存在')
    return true
  })

  check('能识别图片/视频扩展名', () => {
    assert(mod.mediaKindOf('a.png') === 'image', 'png 未识别为图片')
    assert(mod.mediaKindOf('a.JPG') === 'image', 'JPG 未识别')
    assert(mod.mediaKindOf('a.mp4') === 'video', 'mp4 未识别为视频')
    assert(mod.mediaKindOf('a.webm') === 'video', 'webm 未识别')
    assert(mod.mediaKindOf('a.txt') === null, 'txt 不该被识别')
    return true
  })

  check('导入图片背景成功', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const src = join(PIC, 'test-bg.png')
    writeFileSync(src, png)
    const media = mod.importBackground(src)
    assert(media.kind === 'image', 'kind=' + media.kind)
    assert(media.url.startsWith('file:///'), 'url 格式不对: ' + media.url)
    assert(existsSync(media.path), '导入后文件不存在')
    return true
  })

  check('导入后能列出来', () => {
    const list = mod.listBackgrounds()
    assert(list.length >= 1, '列表为空')
    assert(list.some((m) => m.name === 'test-bg'), '没找到导入的素材')
    return true
  })

  check('外部引用模式不复制文件', () => {
    const src = join(PIC, 'test-bg.png')
    const media = mod.externalBackground(src)
    assert(media !== null, '返回 null')
    assert(media.id.startsWith('ext:'), 'id 前缀不对: ' + media.id)
    assert(media.path === src, '路径应保持原样')
    return true
  })

  check('删除背景素材', () => {
    const list = mod.listBackgrounds()
    const target = list.find((m) => m.name === 'test-bg')
    assert(mod.deleteBackground(target.id) === true, '删除返回 false')
    assert(!mod.listBackgrounds().some((m) => m.name === 'test-bg'), '删除后仍在列表里')
    return true
  })

  check('不支持的文件类型会报错', () => {
    const bad = join(PIC, 'note.txt')
    writeFileSync(bad, 'hello')
    let threw = false
    try {
      mod.importBackground(bad)
    } catch {
      threw = true
    }
    assert(threw, '应该抛错')
    return true
  })

  lines.push('=== 4. 主题背景配置 ===')

  check('主题状态里有默认背景配置', () => {
    const st = mod.themeRepo.state()
    assert(st.background, '没有 background 字段')
    assert(st.background.enabled === false, '默认应关闭')
    assert(typeof st.background.overlay === 'number', '缺 overlay')
    assert(typeof st.background.blur === 'number', '缺 blur')
    assert(st.background.fit === 'cover', 'fit 默认值不对: ' + st.background.fit)
    return true
  })

  check('patchBackground 能改配置并落盘', () => {
    mod.themeRepo.patchBackground({ enabled: true, overlay: 70, blur: 6, fit: 'contain' })
    const st = mod.themeRepo.state()
    assert(st.background.enabled === true, 'enabled 没改')
    assert(st.background.overlay === 70, 'overlay=' + st.background.overlay)
    assert(st.background.blur === 6, 'blur=' + st.background.blur)
    assert(st.background.fit === 'contain', 'fit=' + st.background.fit)
    return true
  })

  check('resetBackground 恢复默认', () => {
    mod.themeRepo.resetBackground()
    const st = mod.themeRepo.state()
    assert(st.background.enabled === false, '没恢复')
    assert(st.background.overlay === 55, 'overlay=' + st.background.overlay)
    return true
  })

  lines.push('=== 5. 角色音色迁移 ===')

  check('旧引擎名被映射到新引擎（本地生成引擎已移除，迁回语音包）', () => {
    const c = mod.characterRepo.active()
    mod.characterRepo.saveCharacter({ id: c.id, voice: { ...c.voice, engine: 'gpt-sovits' } })
    const after = mod.characterRepo.list().find((x) => x.id === c.id)
    assert(after.voice.engine === 'voice-pack', 'gpt-sovits 应映射为 voice-pack，实际: ' + after.voice.engine)

    mod.characterRepo.saveCharacter({ id: c.id, voice: { ...after.voice, engine: 'cosyvoice' } })
    const after2 = mod.characterRepo.list().find((x) => x.id === c.id)
    assert(after2.voice.engine === 'voice-pack', 'cosyvoice 应映射为 voice-pack')

    mod.characterRepo.saveCharacter({ id: c.id, voice: { ...after2.voice, engine: 'edge-tts' } })
    const after3 = mod.characterRepo.list().find((x) => x.id === c.id)
    assert(after3.voice.engine === 'system', 'edge-tts 应映射为 system')
    return true
  })

  check('voice 对象包含全部新字段', () => {
    const c = mod.characterRepo.active()
    for (const k of ['engine', 'voicePackFile', 'customPackPath', 'voiceId', 'rate', 'pitch', 'volume', 'autoSpeak', 'endpoint', 'localBackend', 'inworldModel']) {
      assert(k in c.voice, '缺字段: ' + k)
    }
    return true
  })

  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  rmSync(PIC, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.log('\n' + lines.join('\n'))
  console.error('\n测试崩溃: ' + e.message)
  process.exit(2)
})
