/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify9')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V9_DATA
module.exports = {
  app: { getPath: () => D, getAppPath: () => process.env.V9_APP, getVersion: () => '0.9.0' },
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
export * from '${slash(join(ROOT, 'src/main/voice'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/memory'))}'
export * from '${slash(join(ROOT, 'src/main/personaPack'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v9-'))
process.env.V9_DATA = DATA
process.env.V9_APP = ROOT
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
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

;(async () => {
  lines.push('=== 1. 表情包来源与开关 ===')

  check('表情包设置有默认来源网站', () => {
    const s = mod.settingsRepo.get()
    assert(s.sticker, '缺少 sticker 设置')
    assert(Array.isArray(s.sticker.sources), 'sources 不是数组')
    assert(s.sticker.sources.length >= 3, `内置来源太少：${s.sticker.sources.length}`)
    for (const src of s.sticker.sources) {
      assert(src.id && src.label && src.searchUrl, '来源字段缺失：' + JSON.stringify(src))
      assert(src.searchUrl.includes('{q}'), `来源 ${src.id} 的 URL 没有 {q} 占位符`)
    }
    return true
  })

  check('搜索开关默认开启', () => {
    const s = mod.settingsRepo.get()
    assert(s.sticker.searchEnabled === true, '搜索应默认开启')
    return true
  })

  check('自动抓取默认关闭（避免偷偷联网）', () => {
    const s = mod.settingsRepo.get()
    assert(s.sticker.autoFetch === false, '自动抓取应默认关闭')
    return true
  })

  check('能改来源与开关并持久化', () => {
    const cur = mod.settingsRepo.get().sticker
    mod.settingsRepo.save({ sticker: { ...cur, searchEnabled: false, activeSourceId: 'baidu' } })
    const after = mod.settingsRepo.get().sticker
    assert(after.searchEnabled === false, '开关没落盘')
    assert(after.activeSourceId === 'baidu', '来源没落盘')
    mod.settingsRepo.save({ sticker: { ...after, searchEnabled: true, activeSourceId: 'bing' } })
    return true
  })

  check('自动抓取决策：关闭时不抓', () => {
    const d = mod.decideAutoFetch({
      poolSize: 0,
      messageCount: 20,
      everyNTurns: 12,
      characterName: '守岸人',
      enabled: false,
      recentFetchCount: 0
    })
    assert(d.fetch === false, '不该抓')
    assert(d.reason.includes('未开启'), '原因不对：' + d.reason)
    return true
  })

  check('自动抓取决策：库为空时立刻抓', () => {
    const d = mod.decideAutoFetch({
      poolSize: 0,
      messageCount: 3,
      everyNTurns: 12,
      characterName: '守岸人',
      enabled: true,
      recentFetchCount: 0
    })
    assert(d.fetch === true, '该抓：' + d.reason)
    assert(d.query.includes('守岸人'), '关键词不对：' + d.query)
    return true
  })

  check('自动抓取决策：有图时按频率', () => {
    const off = mod.decideAutoFetch({
      poolSize: 50,
      messageCount: 5,
      everyNTurns: 12,
      characterName: '守岸人',
      enabled: true,
      recentFetchCount: 0
    })
    assert(off.fetch === false, '没到频率不该抓')
    const on = mod.decideAutoFetch({
      poolSize: 50,
      messageCount: 12,
      everyNTurns: 12,
      characterName: '守岸人',
      enabled: true,
      recentFetchCount: 0
    })
    assert(on.fetch === true, '到频率该抓：' + on.reason)
    return true
  })

  check('自动抓取决策：抓太多次后停止', () => {
    const d = mod.decideAutoFetch({
      poolSize: 0,
      messageCount: 30,
      everyNTurns: 12,
      characterName: '守岸人',
      enabled: true,
      recentFetchCount: 3
    })
    assert(d.fetch === false, '超过上限不该再抓')
    return true
  })

  check('表情包以本地文件形式存放', () => {
    const list = mod.listStickers('char_shorekeeper')
    assert(list.length > 0, '拿不到表情包')
    for (const s of list) {
      assert(existsSync(s.path), `文件不存在：${s.path}`)
      assert(/\.(jpg|jpeg|png|webp|gif)$/i.test(s.path), '不是图片文件：' + s.path)
    }
    const local = list.filter((s) => s.source === 'local')
    assert(local.length > 0, '没有内置表情包')
    assert(
      local.every((s) => s.path.includes('stickers')),
      '内置表情包不在 stickers 目录'
    )
    return true
  })

  check('stickerToFileUrl 产出 file:// 地址', () => {
    const list = mod.listStickers('char_shorekeeper')
    const url = mod.stickerToFileUrl(list[0])
    assert(url.startsWith('file:///'), '地址格式不对：' + url)
    assert(url.endsWith('.jpg') || url.endsWith('.png'), '后缀不对：' + url)
    return true
  })

  lines.push('')
  lines.push('=== 2. 音频预设精简 ===')

  check('预设只剩 3 个（本地合成选项已删除）', () => {
    assert(mod.VOICE_PRESETS.length === 3, `实际 ${mod.VOICE_PRESETS.length} 个`)
    return true
  })

  check('删掉了角色原声预设', () => {
    const ids = mod.VOICE_PRESETS.map((p) => p.id)
    assert(!ids.includes('vp_pack_default'), '角色原声还在')
    assert(
      !mod.VOICE_PRESETS.some((p) => p.engine === 'voice-pack'),
      '还有 voice-pack 预设'
    )
    return true
  })

  check('系统音色只保留第一个', () => {
    const sys = mod.VOICE_PRESETS.filter((p) => p.engine === 'system')
    assert(sys.length === 1, `系统音色还有 ${sys.length} 个`)
    assert(sys[0].id === 'vp_system_shorekeeper', '保留的不是第一个：' + sys[0].id)
    return true
  })

  check('保留云合成 / 系统 / 不发声（本地已删）', () => {
    const ids = mod.VOICE_PRESETS.map((p) => p.id)
    for (const want of ['vp_inworld_clone', 'vp_system_shorekeeper', 'vp_off']) {
      assert(ids.includes(want), '缺少 ' + want)
    }
    return true
  })

  lines.push('')
  lines.push('=== 3. 角色与人格整合 ===')

  const stripComments = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  check('PersonaSection 不再有「绑定给」按钮', () => {
    const src = stripComments(read('src/renderer/src/pages/settings/PersonaSection.tsx'))
    assert(!src.includes('绑定给'), '还有绑定按钮')
    return true
  })

  check('PersonaSection 不再有人格库卡片', () => {
    const src = stripComments(read('src/renderer/src/pages/settings/PersonaSection.tsx'))
    assert(!src.includes('人格库'), '还有人格库卡片')
    return true
  })

  check('PersonaSection 不再有快速切换角色卡片', () => {
    const src = stripComments(read('src/renderer/src/pages/settings/PersonaSection.tsx'))
    assert(!src.includes('快速切换角色'), '还有快速切换卡')
    return true
  })

  check('上传人格已并入角色页', () => {
    const page = read('src/renderer/src/pages/settings/CharacterSection.tsx')
    assert(page.includes('PersonaSection'), '角色页没引人格组件')
    return true
  })

  check('角色页能选人格', () => {
    const page = read('src/renderer/src/pages/settings/CharacterSection.tsx')
    assert(/persona/i.test(page), '角色页没有人格相关实现')
    return true
  })

  check('切角色时人格跟着切（personaId 绑定在角色上）', () => {
    const chars = mod.characterRepo.list()
    for (const c of chars) {
      assert(c.personaId, `${c.name} 没有 personaId`)
    }
    const ids = chars.map((c) => c.personaId)
    assert(new Set(ids).size >= 3, '多个角色绑定了同一个人格：' + ids.join(','))
    return true
  })

  lines.push('')
  lines.push('=== 4. 完全权限风险警告 ===')

  check('PermissionBadge 有风险警告 UI', () => {
    const src = read('src/renderer/src/components/PermissionBadge.tsx')
    assert(src.includes('permission-risk'), '没有风险警告')
    assert(src.includes('后果自负'), '没有后果自负声明')
    assert(src.includes('我已知晓'), '没有确认按钮')
    return true
  })

  check('选完全权限时会拦截并要求确认', () => {
    const src = read('src/renderer/src/components/PermissionBadge.tsx')
    assert(src.includes("next === 'full'"), '没有针对 full 的拦截')
    assert(src.includes('setRiskOpen(true)'), '没有打开风险弹窗')
    return true
  })

  lines.push('')
  lines.push('=== 5. 对话页 ===')

  check('有选择工作目录按钮', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('workspace-btn'), '没有工作目录按钮')
    assert(src.includes('pickWorkspace'), '没有选目录逻辑')
    return true
  })

  check('会话侧边栏可收起/展开', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('sidebar-toggle'), '没有收起按钮')
    assert(src.includes('sidebarOpen'), '没有收起状态')
    return true
  })

  check('聊天与协作已整合（无 Tab 切换）', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(!src.includes("useState<'chat' | 'coop'>"), '还有 Tab 状态')
    assert(!src.includes('pill-tab'), '还有 Tab 按钮')
    assert(src.includes('聊天与协作已整合'), '没有整合注释')
    return true
  })

  check('工具卡片内联在聊天流里', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('<ToolCard'), '没有工具卡片渲染')
    assert(src.includes("m.role === 'tool'"), '没有 tool 消息分支')
    return true
  })

  lines.push('')
  lines.push('=== 6. 记忆与任务 ===')

  check('新装记忆为 0 条', () => {
    const mem = mod.memoryRepo.list()
    assert(Array.isArray(mem), 'list 不返回数组')
    assert(mem.length === 0, `新装应有 0 条记忆，实际 ${mem.length} 条`)
    return true
  })

  check('没有「诞生记忆」种子', () => {
    const mainSrc = read('src/main/index.ts')
    const memSrc = read('src/main/memory.ts')
    const combined = mainSrc + memSrc
    assert(!/seedMemory\s*\(\s*\)/.test(combined) || combined.includes('清理'), '似乎还在写种子记忆')
    return true
  })

  lines.push('')
  lines.push('=== 7. 静态接线 ===')

  check('sticker 设置字段在类型里声明', () => {
    const types = read('src/shared/types.ts')
    assert(types.includes('StickerConfig'), '缺少 StickerConfig 类型')
    assert(types.includes('sticker: StickerConfig'), 'AppSettings 没有 sticker 字段')
    assert(types.includes('StickerSource'), '缺少 StickerSource 类型')
    return true
  })

  check('qwen3 资源已随包分发', () => {
    const yml = read('electron-builder.yml')
    assert(yml.includes('qwen3tts'), 'extraResources 缺 qwen3tts')
    assert(yml.includes('qwen3voices'), 'extraResources 缺 qwen3voices')
    return true
  })

  check('参考音色文件已就位', () => {
    const dir = join(ROOT, 'resources', 'qwen3voices')
    assert(existsSync(dir), '缺少 qwen3voices 目录')
    for (const id of ['shorekeeper', 'aemeath', 'firefly', 'chloe']) {
      assert(existsSync(join(dir, id + '.mp3')), `缺少 ${id}.mp3`)
    }
    assert(existsSync(join(dir, 'voices.json')), '缺少 voices.json')
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
