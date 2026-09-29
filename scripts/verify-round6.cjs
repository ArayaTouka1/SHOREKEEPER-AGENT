/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const crypto = require('node:crypto')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify6')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.V6_DATA
module.exports = {
  app: { getPath: () => DATA, getAppPath: () => process.env.V6_APP, getVersion: () => '0.7.0' },
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

const entry = join(OUT, 'entry.ts')
writeFileSync(
  entry,
  `
export * from '${slash(join(ROOT, 'src/main/characterCard'))}'
export * from '${slash(join(ROOT, 'src/main/persona'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/models'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/chat'))}'
export * from '${slash(join(ROOT, 'src/main/personaCard'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v6-'))
process.env.V6_DATA = DATA
process.env.V6_APP = ROOT
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

const CARD_IDS = ['shorekeeper', 'aemeath', 'firefly', 'chloe']
const EXPECT_NAME = { shorekeeper: '守岸人', aemeath: '爱弥斯', firefly: '流萤', chloe: '嘉神川克罗艾' }
const EXPECT_ADDR = { shorekeeper: '你', aemeath: '漂泊者', firefly: '开拓者', chloe: '学弟' }

;(async () => {
  lines.push('=== 1. 新「陪伴版」角色卡 ===')

  check('4 张新卡都已导入（人格包结构）', () => {
    for (const id of CARD_IDS) {
      assert(existsSync(join(ROOT, 'resources', 'cards', `${id}.json`)), `缺少 ${id}.json`)
      const packDir = join(ROOT, 'resources', 'personas', id)
      assert(existsSync(packDir), `缺少 ${id}/ 人格包目录`)
    }
    return true
  })

  check('卡里是「陪伴版」内容', () => {
    for (const id of CARD_IDS) {
      const raw = JSON.parse(readFileSync(join(ROOT, 'resources', 'cards', `${id}.json`), 'utf-8'))
      assert(String(raw.data.name).includes('陪伴版'), `${id} 不是陪伴版卡：${raw.data.name}`)
    }
    return true
  })

  check('角色名去掉了「-陪伴版」后缀', () => {
    for (const id of CARD_IDS) {
      const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', `${id}.json`))
      assert(card.name === EXPECT_NAME[id], `${id} 名字应为 ${EXPECT_NAME[id]}，实际 ${card.name}`)
      assert(!card.name.includes('陪伴版'), `${id} 名字还带后缀：${card.name}`)
    }
    return true
  })

  check('称呼抽取正确', () => {
    for (const id of CARD_IDS) {
      const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', `${id}.json`))
      assert(card.address === EXPECT_ADDR[id], `${id} 称呼应为 ${EXPECT_ADDR[id]}，实际 ${card.address}`)
    }
    return true
  })

  check('世界书与开场白完整', () => {
    for (const id of CARD_IDS) {
      const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', `${id}.json`))
      assert(card.worldBook.length === 10, `${id} 世界书应为 10，实际 ${card.worldBook.length}`)
      assert(card.alternateGreetings.length === 3, `${id} 备选开场白应为 3`)
      assert(card.personaContent.length > 3500, `${id} 人格正文过短：${card.personaContent.length}`)
    }
    return true
  })

  check('人格正文说明同时覆盖 {{user}} 与 {user} 两种写法', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'aemeath.json'))
    assert(card.personaContent.includes('{{user}}'), '缺双花括号说明')
    assert(card.personaContent.includes('{user}'), '缺单花括号说明')
    return true
  })

  lines.push('=== 2. 克罗艾头像 ===')

  check('克罗艾头像来自真实立绘（不是占位图）', () => {
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    const chloe = chars.find((c) => c.id === 'char_chloe')
    assert(chloe, '找不到克罗艾')
    assert(chloe.avatar.main.length > 300000, '头像数据过小，可能还是占位图：' + chloe.avatar.main.length)
    assert(chloe.avatar.main.startsWith('data:image/'), '头像不是内联图片')
    return true
  })

  check('4 个角色头像互不相同', () => {
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    const fps = new Set(
      chars.map((c) => crypto.createHash('md5').update(String(c.avatar.main)).digest('hex'))
    )
    assert(fps.size === 4, '头像有重复：' + fps.size)
    return true
  })

  lines.push('=== 3. 断开连接 ===')

  check('本地模型能连接也能断开', () => {
    mod.modelRepo.markConnected('local_ollama', true)
    let m = mod.modelRepo.list().find((x) => x.id === 'local_ollama')
    assert(m.available === true, '连接没生效')
    assert(mod.modelRepo.selectable().some((x) => x.id === 'local_ollama'), '连接后应出现在可选列表')

    mod.modelRepo.disconnect('local_ollama')
    m = mod.modelRepo.list().find((x) => x.id === 'local_ollama')
    assert(m.available === false, '断开没生效')
    assert(!mod.modelRepo.selectable().some((x) => x.id === 'local_ollama'), '断开后不该出现在可选列表')
    return true
  })

  check('断开当前模型会自动回退到 API 模型', () => {
    mod.modelRepo.markConnected('local_ollama', true)
    mod.modelRepo.setActive('local_ollama')
    assert(mod.modelRepo.active().id === 'local_ollama', '前置：应先切到本地模型')

    mod.modelRepo.disconnect('local_ollama')
    const active = mod.modelRepo.active()
    assert(active.kind === 'api', '断开后应回退到 API 模型，实际：' + active.id)
    return true
  })

  check('全部断开可用', () => {
    mod.modelRepo.markConnected('local_ollama', true)
    mod.modelRepo.markConnected('local_lmstudio', true)
    assert(mod.modelRepo.list().filter((m) => m.kind === 'local' && m.available).length === 2, '前置：应有两个已连接')

    mod.modelRepo.disconnectAll()
    const still = mod.modelRepo.list().filter((m) => m.kind === 'local' && m.available)
    assert(still.length === 0, '全部断开后仍有：' + still.map((m) => m.id).join(','))
    return true
  })

  check('断开全部后当前模型不是本地模型', () => {
    const locals = mod.modelRepo.list().filter((m) => m.kind === 'local')
    if (locals.length === 0) return true
    const id = locals[0].id
    mod.modelRepo.markConnected(id, true)
    mod.modelRepo.setActive(id)
    mod.modelRepo.disconnectAll()
    assert(mod.modelRepo.active().kind === 'api', '应回退到 API 模型')
    return true
  })

  check('断开状态会持久化（重读仍是断开）', () => {
    mod.modelRepo.markConnected('local_ollama', true)
    mod.modelRepo.disconnect('local_ollama')
    const st = mod.modelRepo.state()
    assert(!st.localConnections['local_ollama'], 'state 里还留着连接记录')
    return true
  })

  lines.push('=== 4. 安装包默认配置 ===')

  check('所有内置 API Key 默认为空', () => {
    const s = mod.settingsRepo.get()
    assert(s.llm.apiKey === '', 'llm.apiKey 应为空，实际：' + JSON.stringify(s.llm.apiKey))
    assert(s.inworld.apiKey === '', 'inworld.apiKey 应为空')
    assert(s.cloudTts.apiKey === '', 'cloudTts.apiKey 应为空')
    return true
  })

  check('默认不预置任何密钥（源码里也没有硬编码 Key）', () => {
    const src = readFileSync(join(ROOT, 'src/main/settings.ts'), 'utf-8')
    assert(!/VkhtQmE0dmxz/.test(src), 'settings.ts 里还留着硬编码的 Inworld Key')
    assert(!/apiKey:\s*'[A-Za-z0-9+/=]{40,}'/.test(src), 'settings.ts 里还有长密钥字面量')
    return true
  })

  check('不再从旧字段回填密钥', () => {
    const src = readFileSync(join(ROOT, 'src/main/settings.ts'), 'utf-8')
    assert(!src.includes('merged.cloudTts.apiKey = merged.inworld.apiKey'), '回填逻辑还在')
    return true
  })

  check('默认没有任何对话', () => {
    const convs = mod.chatRepo.conversations()
    assert(Array.isArray(convs), 'conversations 不是数组')
    assert(convs.length === 0, '默认应有 0 个对话，实际：' + convs.length)
    return true
  })

  check('默认没有任何消息', () => {
    const msgs = mod.chatRepo.messages('不存在的会话')
    assert(Array.isArray(msgs), 'messages 不是数组')
    assert(msgs.length === 0, '不该有消息')
    return true
  })

  check('默认选中一个 API 模型（不需要 Key 也能进界面）', () => {
    const active = mod.modelRepo.active()
    assert(active.kind === 'api', '默认应选中 API 模型，实际：' + active.id)
    return true
  })

  lines.push('=== 5. 对话页交互 ===')

  check('对话页有人格切换器', () => {
    const chat = readFileSync(join(ROOT, 'src/renderer/src/pages/ChatPage.tsx'), 'utf-8')
    assert(chat.includes('PersonaSwitcher'), 'ChatPage 没挂载 PersonaSwitcher')
    const sw = readFileSync(join(ROOT, 'src/renderer/src/components/PersonaSwitcher.tsx'), 'utf-8')
    assert(sw.includes('data-testid="persona-switcher"'), '缺切换按钮')
    assert(sw.includes('data-testid="persona-popover"'), '缺面板')
    assert(sw.includes('data-testid="persona-toast"'), '缺切换反馈')
    return true
  })

  check('切人格时会同步切角色与语音', () => {
    const sw = readFileSync(join(ROOT, 'src/renderer/src/components/PersonaSwitcher.tsx'), 'utf-8')
    assert(sw.includes('switchCharacter'), '切人格没调用 switchCharacter（不会换语音）')
    assert(sw.includes('ownerOf'), '缺人格→角色归属映射')
    assert(sw.includes('音色同步切换'), '缺音色同步提示')
    return true
  })

  check('模型切换有反馈', () => {
    const ms = readFileSync(join(ROOT, 'src/renderer/src/components/ModelSelector.tsx'), 'utf-8')
    assert(ms.includes('toast') && ms.includes('setToast'), '缺切换反馈状态')
    assert(ms.includes('切换中'), '缺切换中状态')
    assert(/切换(成功|完成)|已切换|toast/.test(ms), '缺切换反馈')
    return true
  })

  check('对话页可直接连接/断开本地模型', () => {
    const ms = readFileSync(join(ROOT, 'src/renderer/src/components/ModelSelector.tsx'), 'utf-8')
    assert(ms.includes('connectLocal'), '缺连接本地模型')
    assert(ms.includes('disconnectLocal'), '缺断开本地模型')
    assert(ms.includes('data-testid={`chat-disconnect-'), '缺对话页断开按钮')
    assert(ms.includes('data-testid="local-toggle"'), '缺本地模型折叠区')
    return true
  })

  check('设置页模型区有断开入口', () => {
    const mset = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/ModelSection.tsx'), 'utf-8')
    assert(mset.includes('断开连接'), '缺断开按钮')
    assert(mset.includes('全部断开'), '缺全部断开')
    const sett = readFileSync(join(ROOT, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf-8')
    assert(sett.includes('清空密钥'), '缺清空密钥')
    assert(sett.includes('data-testid="clear-api-key"'), '缺清空密钥按钮标识')
    assert(sett.includes('data-testid="save-api-key"'), '缺保存密钥按钮标识')
    assert(!mset.includes('data-testid="clear-api-key"'), '密钥按钮不该同时留在 ModelSection 里')
    return true
  })

  check('云合成有断开入口', () => {
    const ctp = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/CloudTtsPanel.tsx'), 'utf-8')
    assert(ctp.includes('data-testid="tts-disconnect"'), '缺云合成断开按钮')
    assert(ctp.includes('已断开连接'), '缺断开反馈')
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
