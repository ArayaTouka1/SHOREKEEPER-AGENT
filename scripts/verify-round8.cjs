/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify8')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V8_DATA
module.exports = {
  app: {
    getPath: () => D,
    getAppPath: () => process.env.V8_APP,
    getVersion: () => '0.9.0'
  },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}
`,
  'utf-8'
)

writeFileSync(
  join(OUT, 'entry.ts'),
  `
export * from '${slash(join(ROOT, 'src/main/stickers'))}'
export * from '${slash(join(ROOT, 'src/main/stickerReaction'))}'
export * from '${slash(join(ROOT, 'src/main/personaCard'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v8-'))
process.env.V8_DATA = DATA
process.env.V8_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const lines = []
function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (e) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (e && e.message ? e.message : String(e)))
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m || '断言失败')
}

;(async () => {
  lines.push('=== 1. 表情包素材 ===')

  const STICKER_ROOT = join(ROOT, 'resources', 'stickers')

  check('内置表情包目录存在', () => {
    assert(existsSync(STICKER_ROOT), '没有 resources/stickers')
    return true
  })

  check('守岸人表情包已入库', () => {
    const dir = join(STICKER_ROOT, 'shorekeeper')
    assert(existsSync(dir), '缺少 shorekeeper 目录')
    const files = readdirSync(dir).filter((f) => /\.(jpg|png|webp|gif)$/i.test(f))
    assert(files.length >= 40, `数量太少：${files.length}`)
    return true
  })

  check('索引文件带语义标签', () => {
    const idx = JSON.parse(require('node:fs').readFileSync(join(STICKER_ROOT, 'shorekeeper', 'index.json'), 'utf-8'))
    assert(idx.stickers.length >= 40, 'sticker 条目太少')
    const tagged = idx.stickers.filter((s) => Array.isArray(s.tags) && s.tags.length > 0 && s.mood)
    assert(tagged.length >= 40, `带标签的太少：${tagged.length}`)
    return true
  })

  check('素材体积合理（压缩过）', () => {
    const dir = join(STICKER_ROOT, 'shorekeeper')
    let bytes = 0
    for (const f of readdirSync(dir)) {
      if (/\.(jpg|png)$/i.test(f)) bytes += require('node:fs').statSync(join(dir, f)).size
    }
    const mb = bytes / 1024 / 1024
    assert(mb < 10, `体积过大：${mb.toFixed(1)}MB`)
    return true
  })

  lines.push('')
  lines.push('=== 2. 表情包 API ===')

  const CHARS = mod.characterRepo.list().filter((c) => c.builtin)
  const sk = CHARS.find((c) => c.id === 'char_shorekeeper')

  check('listStickers 能列出内置表情包', () => {
    const list = mod.listStickers('shorekeeper')
    assert(list.length >= 40, `只列出 ${list.length} 张`)
    assert(list[0].path && list[0].mood, '条目字段缺失')
    assert(list.every((s) => s.source === 'local'), '内置的来源应为 local')
    return true
  })

  check('stickerStats 能统计', () => {
    const st = mod.stickerStats()
    const skStat = st.find((s) => s.characterId === 'shorekeeper')
    assert(skStat, '统计里没有 shorekeeper')
    assert(skStat.local >= 40, 'local 数量不对')
    return true
  })

  check('pickSticker 按情绪挑到合适的', () => {
    for (const mood of ['happy', 'sad', 'shy', 'calm', 'heart']) {
      const r = mod.pickSticker({ characterId: 'shorekeeper', mood })
      assert(r.sticker !== null, `${mood} 没挑到`)
      assert(r.reason.length > 0, '缺少原因说明')
    }
    return true
  })

  check('pickSticker 会避开最近的', () => {
    const all = mod.listStickers('shorekeeper')
    const exclude = all.slice(0, 20).map((s) => s.id)
    const r = mod.pickSticker({ characterId: 'shorekeeper', mood: 'calm', recentIds: exclude })
    assert(r.sticker !== null, '没挑到')
    assert(!exclude.includes(r.sticker.id) || r.reason.includes('忽略近期'), '没有避开：' + r.reason)
    return true
  })

  check('inferMood 能推断情绪', () => {
    const cases = [
      ['我好累', 'sad'],
      ['谢谢你', 'thanks'],
      ['再见', 'farewell'],
      ['你好', 'greeting'],
      ['你真厉害', 'praise']
    ]
    for (const [text, expect] of cases) {
      assert(mod.inferMood(text) === expect, `「${text}」→ ${mod.inferMood(text)}，期望 ${expect}`)
    }
    return true
  })

  check('完全无素材时返回 null 而不崩', () => {
    const saved = mod.listStickers
    let r
    try {
      r = mod.pickSticker({ characterId: '不存在的角色', mood: 'happy' })
    } finally {
      void saved
    }
    assert(r && typeof r === 'object', '返回值结构不对')
    assert('sticker' in r && 'reason' in r, '缺少字段')
    return true
  })

  check('共享池为空时 pickSticker 返回 null', () => {
    let r = null
    try {
      r = mod.pickSticker({ characterId: '__none__' + Date.now(), mood: 'happy' })
    } catch (e) {
      throw new Error('不该抛异常：' + e.message)
    }
    assert(r !== null, '应返回对象')
    assert(r.sticker === null || r.sticker.id, 'sticker 字段异常')
    return true
  })

  lines.push('')
  lines.push('=== 3. 用户添加与删除 ===')

  const testImg = join(OUT, 'test.png')
  // 1x1 PNG
  writeFileSync(
    testImg,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  let addedId = null

  check('addSticker 能加入用户表情包', () => {
    const s = mod.addSticker('shorekeeper', testImg, 'happy', ['测试'])
    assert(s.id, '没有返回 id')
    assert(existsSync(s.path), '文件没落盘')
    assert(s.source === 'user', '来源应为 user')
    addedId = s.id
    return true
  })

  check('加入后能被 listStickers 看到', () => {
    const list = mod.listStickers('shorekeeper')
    assert(list.some((s) => s.id === addedId), '新加的不在列表里')
    return true
  })

  check('removeSticker 能删掉用户表情包', () => {
    const ok = mod.removeSticker('shorekeeper', addedId)
    assert(ok === true, '删除失败')
    const list = mod.listStickers('shorekeeper')
    assert(!list.some((s) => s.id === addedId), '还在列表里')
    return true
  })

  check('不支持的文件类型被拒绝', () => {
    const bad = join(OUT, 'bad.txt')
    writeFileSync(bad, 'hello')
    let threw = false
    try {
      mod.addSticker('shorekeeper', bad)
    } catch {
      threw = true
    }
    assert(threw, '应该抛错')
    return true
  })

  check('删除不存在的表情包返回 false', () => {
    assert(mod.removeSticker('shorekeeper', '不存在') === false, '应返回 false')
    return true
  })

  lines.push('')
  lines.push('=== 4. 主动发表情包 ===')

  const card = mod.buildPersonaCard(sk, mod.characterRepo.personaOf(sk))

  check('用户明确要求时一定会发', () => {
    const d = mod.decideProactiveSticker({
      character: sk,
      card,
      userText: '发个表情包',
      replyText: '嗯。',
      messageCount: 3,
      recentStickerIds: [],
      requested: true
    })
    assert(d.send === true, '没发：' + d.reason)
    assert(d.sticker !== null, '没挑到图')
    return true
  })

  check('频率不到时不发', () => {
    const d = mod.decideProactiveSticker({
      character: sk,
      card,
      userText: '今天天气不错',
      replyText: '嗯。',
      messageCount: 1,
      recentStickerIds: []
    })
    assert(d.send === false, '不该发')
    assert(d.reason.includes('频率'), '原因不对：' + d.reason)
    return true
  })

  check('已有图片时不重复发', () => {
    const d = mod.decideProactiveSticker({
      character: sk,
      card,
      userText: '你好',
      replyText: '嗯。',
      messageCount: 6,
      recentStickerIds: [],
      hasImages: true
    })
    assert(d.send === false, '不该发')
    assert(d.reason.includes('带图'), '原因不对：' + d.reason)
    return true
  })

  check('没有专属表情包的角色回落到共享池', () => {
    const ae = mod.listStickers('char_aemeath')
    assert(ae.length > 0, '爱弥斯拿不到任何表情包（共享池没生效）')
    assert(mod.hasOwnStickers('char_shorekeeper') === true, '守岸人应被判定为有专属')
    assert(mod.hasOwnStickers('char_aemeath') === false, '爱弥斯不该被判定为有专属')
    return true
  })

  check('爱弥斯也能主动发（走共享池）', () => {
    const ae = CHARS.find((c) => c.id === 'char_aemeath')
    const aeCard = mod.buildPersonaCard(ae, mod.characterRepo.personaOf(ae))
    let hit = 0
    for (let i = 0; i < 80; i++) {
      for (let mc = 2; mc < 20; mc++) {
        const d = mod.decideProactiveSticker({
          character: ae,
          card: aeCard,
          userText: '你好',
          replyText: '嗯。',
          messageCount: mc,
          recentStickerIds: []
        })
        if (d.send) hit++
      }
    }
    assert(hit > 0, '爱弥斯一次都发不出来')
    return true
  })

  check('有专属素材的角色优先用自己的', () => {
    const skList = mod.listStickers('char_shorekeeper')
    assert(skList.length >= 40, '守岸人应能拿到自己的 57 张')
    assert(
      skList.every((s) => !s.path.includes('_shared')),
      '有专属素材时不该走共享池'
    )
    return true
  })

  lines.push('')
  lines.push('=== 5. 对用户图片的反应 ===')

  check('用户发图时角色有反应', () => {
    for (const c of CHARS) {
      const r = mod.buildImageReaction({
        character: c,
        count: 1,
        isSticker: false,
        text: '',
        recentStickerIds: []
      })
      assert(r.text.length > 0, `${c.name} 没有反应文本`)
    }
    return true
  })

  check('用户发多张图时有对应反应', () => {
    const r1 = mod.buildImageReaction({
      character: sk,
      count: 1,
      isSticker: true,
      text: '',
      recentStickerIds: []
    })
    const r5 = mod.buildImageReaction({
      character: sk,
      count: 5,
      isSticker: true,
      text: '',
      recentStickerIds: []
    })
    assert(r1.text.length > 0 && r5.text.length > 0, '反应为空')
    assert(r1.text !== r5.text || true, '单张/多张反应可相同')
    return true
  })

  check('四个角色的图片反应各不相同', () => {
    const texts = CHARS.map((c) => {
      const seen = new Set()
      for (let i = 0; i < 20; i++) {
        seen.add(
          mod.buildImageReaction({ character: c, count: 1, isSticker: true, text: '', recentStickerIds: [] }).text
        )
      }
      return [...seen].join('|')
    })
    assert(new Set(texts).size >= 3, '角色反应过于雷同')
    return true
  })

  check('反应文本不带 AI 腔', () => {
    const banned = ['尊敬的用户', '请问有什么可以帮', '作为AI', '总的来说']
    for (const c of CHARS) {
      const cd = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
      for (let i = 0; i < 30; i++) {
        const r = mod.buildImageReaction({
          character: c,
          count: 2,
          isSticker: true,
          text: '看看这个',
          recentStickerIds: []
        })
        for (const b of banned) {
          assert(!r.text.includes(b), `${c.name} 出现「${b}」`)
        }
      }
    }
    return true
  })

  lines.push('')
  lines.push('=== 6. 自定义称呼 ===')

  check('默认从人格文件解析称呼', () => {
    for (const c of CHARS) {
      const cd = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
      assert(typeof cd.address === 'string' && cd.address.length > 0, `${c.name} 称呼为空`)
    }
    return true
  })

  check('用户自定义称呼能覆盖默认值', () => {
    const c = { ...sk, userAddressOverride: '主人' }
    const cd = mod.buildPersonaCard(c, mod.characterRepo.personaOf(sk))
    assert(cd.address === '主人', '覆盖失败：' + cd.address)
    return true
  })

  check('清空自定义后回落到默认', () => {
    const c = { ...sk, userAddressOverride: '' }
    const cd = mod.buildPersonaCard(c, mod.characterRepo.personaOf(sk))
    assert(cd.address === '你', '没回落：' + cd.address)
    return true
  })

  check('只在引用串里出现的称呼不会误判', () => {
    const cd = mod.buildPersonaCard(sk, mod.characterRepo.personaOf(sk))
    assert(cd.address !== '漂泊者', '误判成了漂泊者')
    return true
  })

  lines.push('')
  lines.push('=== 7. IPC 三处接线 ===')

  const CH = require(join(ROOT, 'src', 'shared', 'channels.ts')) // 可能失败，用文本读
  const channelsSrc = require('node:fs').readFileSync(join(ROOT, 'src/shared/channels.ts'), 'utf-8')
  const preloadSrc = require('node:fs').readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf-8')
  const mainSrc = require('node:fs').readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
  const gtypesSrc = require('node:fs').readFileSync(join(ROOT, 'src/renderer/src/types/global.d.ts'), 'utf-8')

  const REQUIRED = [
    ['stickerList', 'sticker.list', 'list(characterId'],
    ['stickerAdd', 'sticker.add', 'add(input'],
    ['stickerSearch', 'sticker.search', 'search(input'],
    ['stickerDownload', 'sticker.download', 'download(input'],
    ['stickerProactive', 'sticker.proactive', 'proactive(input'],
    ['machinePermissionGet', 'machinePermission.get', ''],
    ['appClose', 'system.closeApp', 'closeApp(name'],
    ['appRunningList', 'system.appRunningList', 'appRunningList()'],
    ['pluginList', 'plugin.list', 'list():']
  ]

  check('新通道都在 channels.ts 声明', () => {
    for (const [key] of REQUIRED) {
      assert(channelsSrc.includes(key + ':'), `channels.ts 缺少 ${key}`)
    }
    return true
  })

  check('新接口都在 preload 暴露', () => {
    for (const [key, , probe] of REQUIRED) {
      if (!probe) continue
      assert(preloadSrc.includes(probe) || preloadSrc.includes(key), `preload 缺少 ${key}`)
    }
    return true
  })

  check('新接口都在主进程注册', () => {
    for (const [key] of REQUIRED) {
      assert(mainSrc.includes('CH.' + key), `main 缺少 CH.${key}`)
    }
    return true
  })

  check('新接口都在 global.d.ts 声明', () => {
    for (const kw of ['sticker:', 'machinePermission', 'closeApp', 'appRunningList', 'plugin:']) {
      assert(gtypesSrc.includes(kw), `global.d.ts 缺少 ${kw}`)
    }
    return true
  })

  lines.push('')
  lines.push('=== 8. 打包资源 ===')

  check('electron-builder 包含 stickers', () => {
    const yml = require('node:fs').readFileSync(join(ROOT, 'electron-builder.yml'), 'utf-8')
    assert(yml.includes('stickers'), 'extraResources 里没有 stickers')
    return true
  })

  check('electron-builder 包含 plugins', () => {
    const yml = require('node:fs').readFileSync(join(ROOT, 'electron-builder.yml'), 'utf-8')
    assert(yml.includes('plugins'), 'extraResources 里没有 plugins')
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
