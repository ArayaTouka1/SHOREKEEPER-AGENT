/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verifycards')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.VC_DATA
module.exports = {
  app: {
    getPath: () => DATA,
    getAppPath: () => process.env.VC_APP,
    getVersion: () => '0.6.0'
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

const entry = join(OUT, 'entry.ts')
writeFileSync(
  entry,
  `
export * from '${slash(join(ROOT, 'src/main/characterCard'))}'
export * from '${slash(join(ROOT, 'src/main/persona'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'vc-'))
process.env.VC_DATA = DATA
process.env.VC_APP = ROOT
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
const CARD_NAMES = { shorekeeper: '守岸人', aemeath: '爱弥斯', firefly: '流萤', chloe: '嘉神川克罗艾' }

;(async () => {
  lines.push('=== 1. 角色卡解析 ===')

  check('4 张卡与人格包都在', () => {
    for (const id of CARD_IDS) {
      const f = join(ROOT, 'resources', 'cards', `${id}.json`)
      assert(existsSync(f), `缺少 ${id}.json`)
      const packDir = join(ROOT, 'resources', 'personas', id)
      if (existsSync(packDir)) {
        const files = readdirSync(packDir)
        assert(files.length >= 6, `${id}/ 文件太少`)
      } else {
        assert(existsSync(join(ROOT, 'resources', 'personas', `${id}.txt`)), `缺少 ${id} 人格`)
      }
    }
    return true
  })

  check('每张卡都能解析出关键字段', () => {
    for (const id of CARD_IDS) {
      const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', `${id}.json`))
      assert(card.name === CARD_NAMES[id], `${id} 名字不对：${card.name}`)
      assert(card.description.length > 1000, `${id} 描述太短：${card.description.length}`)
      assert(card.personality.length > 10, `${id} 缺性格标签`)
      assert(card.firstMes.length > 50, `${id} 缺开场白`)
      assert(card.alternateGreetings.length === 3, `${id} 备选开场白应为 3，实际 ${card.alternateGreetings.length}`)
      assert(card.worldBook.length === 10, `${id} 世界书应为 10 条，实际 ${card.worldBook.length}`)
      assert(card.personaContent.length > 4000, `${id} 人格正文太短：${card.personaContent.length}`)
    }
    return true
  })

  check('称呼抽取正确', () => {
    const expect = { shorekeeper: '你', aemeath: '漂泊者', firefly: '开拓者', chloe: '学弟' }
    for (const id of CARD_IDS) {
      const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', `${id}.json`))
      assert(card.address === expect[id], `${id} 称呼应为 ${expect[id]}，实际 ${card.address}`)
    }
    return true
  })

  check('人格正文包含描述/示例/约束/世界观', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'shorekeeper.json'))
    for (const key of ['## 角色设定', '## 性格关键词', '## 示例对话', '## 输出格式要求', '## 硬性约束', '## 世界观资料']) {
      assert(card.personaContent.includes(key), `人格正文缺少「${key}」`)
    }
    return true
  })

  check('人格正文里没有残留占位符语法错误', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'chloe.json'))
    const open = (card.personaContent.match(/\{\{/g) || []).length
    const close = (card.personaContent.match(/\}\}/g) || []).length
    assert(open === close, `花括号不配对：${open} vs ${close}`)
    return true
  })

  lines.push('=== 2. 世界书 ===')

  check('世界书条目结构完整', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'shorekeeper.json'))
    for (const e of card.worldBook) {
      assert(Array.isArray(e.keys), 'keys 不是数组')
      assert(typeof e.content === 'string' && e.content.length > 10, 'content 太短')
      assert(typeof e.constant === 'boolean', 'constant 不是布尔')
    }
    return true
  })

  check('关键词命中世界书', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'shorekeeper.json'))
    const hit = mod.pickWorldBook(card.worldBook, '黑海岸的钢琴还在吗')
    assert(hit.length > 0, '没命中任何条目')
    const text = hit.map((e) => e.content).join('')
    assert(text.includes('黑海岸') || text.includes('钢琴'), '命中的条目内容不对')
    return true
  })

  check('无关输入不命中关键词条目', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'shorekeeper.json'))
    const hit = mod.pickWorldBook(card.worldBook, 'zzzqqqxxx')
    const nonConstant = hit.filter((e) => !e.constant)
    assert(nonConstant.length === 0, '不该命中关键词条目：' + nonConstant.map((e) => e.keys[0]).join(','))
    return true
  })

  check('常驻条目始终包含', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'shorekeeper.json'))
    const constantCount = card.worldBook.filter((e) => e.constant).length
    if (constantCount === 0) return true
    const hit = mod.pickWorldBook(card.worldBook, '随便说点什么')
    assert(hit.filter((e) => e.constant).length === constantCount, '常驻条目没全部包含')
    return true
  })

  check('renderWorldBook 生成可读文本', () => {
    const card = mod.parseCardFile(join(ROOT, 'resources', 'cards', 'firefly.json'))
    const hit = mod.pickWorldBook(card.worldBook, '萨姆是什么')
    const text = mod.renderWorldBook(hit)
    if (hit.length) {
      assert(text.includes('相关设定'), '缺少标题')
      assert(text.includes('- '), '缺少条目列表')
    }
    return true
  })

  check('空世界书返回空串', () => {
    assert(mod.renderWorldBook([]) === '', '空数组应返回空串')
    return true
  })

  lines.push('=== 3. 角色与人格注册 ===')

  check('内置人格清单包含 4 个', () => {
    assert(mod.PERSONA_FILES.length === 4, '人格数应为 4，实际 ' + mod.PERSONA_FILES.length)
    const ids = mod.PERSONA_FILES.map((p) => p.id)
    for (const need of ['persona_shorekeeper', 'persona_aemeath', 'persona_firefly', 'persona_chloe']) {
      assert(ids.includes(need), '缺少人格：' + need)
    }
    return true
  })

  check('角色库有 4 个内置角色', () => {
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    assert(chars.length === 4, '角色数应为 4，实际 ' + chars.length)
    const names = chars.map((c) => c.name)
    for (const n of ['守岸人', '爱弥斯', '流萤', '嘉神川克罗艾']) {
      assert(names.includes(n), '缺少角色：' + n)
    }
    return true
  })

  check('每个角色都绑定了存在的人格', () => {
    const personaIds = mod.PERSONA_FILES.map((p) => p.id)
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      assert(personaIds.includes(c.personaId), `${c.name} 绑定了不存在的人格：${c.personaId}`)
    }
    return true
  })

  check('每个角色都有头像与音色', () => {
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      assert(c.avatar && c.avatar.main, `${c.name} 缺头像`)
      assert(c.avatar.main.startsWith('data:'), `${c.name} 头像不是内联数据`)
      assert(c.voice && (c.voice.voicePackFile || c.voice.voiceId), `${c.name} 缺音色`)
    }
    return true
  })

  check('能读到每个角色的角色卡', () => {
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      const card = mod.readCharacterCard(c.id)
      assert(card !== null, `${c.name} 读不到角色卡`)
      assert(card.name === c.name, `${c.name} 卡片名不匹配：${card.name}`)
    }
    return true
  })

  check('人格正文与角色卡一致', () => {
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      const persona = mod.characterRepo.personaOf(c)
      const card = mod.readCharacterCard(c.id)
      assert(persona.content.length > 500, `${c.name} 人格正文太短：${persona.content.length}`)
      assert(persona.content.includes(card.name) || persona.content.includes(c.name), `${c.name} 人格正文里没有角色名`)
    }
    return true
  })

  lines.push('=== 4. 人设卡（从角色卡推断）===')

  check('4 个角色的人设卡称呼可用', () => {
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      const card = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
      assert(typeof card.address === 'string' && card.address.length > 0, `${c.name} 称呼为空`)
    }
    return true
  })

  check('4 个角色口吻不全相同', () => {
    const tones = new Set()
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      tones.add(mod.buildPersonaCard(c, mod.characterRepo.personaOf(c)).selfTone)
    }
    assert(tones.size >= 2, '所有角色口吻都一样：' + Array.from(tones).join(','))
    return true
  })

  check('同一句问候，4 个角色回复不同', () => {
    const replies = mod.characterRepo
      .list()
      .filter((x) => x.builtin)
      .map((c) => {
        const card = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
        return mod.personaReply({ card, intent: 'greeting', userText: '你好', memories: [] })
      })
    assert(new Set(replies).size >= 3, '回复重复过多：\n' + replies.join('\n---\n'))
    return true
  })

  check('回复里没有客服腔', () => {
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      const card = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
      for (const intent of ['greeting', 'birth', 'opinion', 'identity', 'capability', 'memory', 'sad', 'chat']) {
        for (let i = 0; i < 6; i++) {
          const r = mod.personaReply({ card, intent, userText: '测试', memories: [] })
          for (const b of ['尊敬的用户', '请问有什么可以帮您', '我是AI', '作为一个语言模型']) {
            assert(!r.includes(b), `${c.name} 的 ${intent} 出现禁忌词「${b}」`)
          }
        }
      }
    }
    return true
  })

  lines.push('=== 5. 语音库展开/隐藏 ===')

  check('CloudTtsPanel 有折叠开关', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/CloudTtsPanel.tsx'), 'utf-8')
    assert(src.includes('data-testid="voice-lib-toggle"'), '缺折叠按钮')
    assert(src.includes('data-testid="voice-lib-body"'), '缺折叠内容区')
    assert(src.includes('可用音色库'), '缺标题')
    assert(src.includes('收起'), '缺收起文案')
    assert(src.includes('展开'), '缺展开文案')
    return true
  })

  check('语音库有搜索与语言筛选', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/CloudTtsPanel.tsx'), 'utf-8')
    assert(src.includes('data-testid="voice-lib-search"'), '缺搜索框')
    assert(src.includes('data-testid="voice-lib-lang"'), '缺语言筛选')
    assert(src.includes('全部语言'), '缺语言选项')
    return true
  })

  check('音色库默认折叠', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/CloudTtsPanel.tsx'), 'utf-8')
    assert(/const \[open, setOpen\] = useState\(false\)/.test(src), '默认应是折叠状态')
    return true
  })

  check('音色数量多时懒渲染', () => {
    const src = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/CloudTtsPanel.tsx'), 'utf-8')
    assert(src.includes('showAll'), '缺 showAll 状态')
    assert(src.includes('显示全部'), '缺「显示全部」按钮')
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
