/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify7')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.V7_DATA
module.exports = {
  app: { getPath: () => DATA, getAppPath: () => process.env.V7_APP, getVersion: () => '0.8.0' },
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
export * from '${slash(join(ROOT, 'src/main/personaPack'))}'
export * from '${slash(join(ROOT, 'src/main/persona'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/personaCard'))}'
export * from '${slash(join(ROOT, 'src/main/models'))}'
export * from '${slash(join(ROOT, 'src/main/llm'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v7-'))
process.env.V7_DATA = DATA
process.env.V7_APP = ROOT
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

const PACKS = ['shorekeeper', 'aemeath', 'firefly', 'chloe']
const PERSONA_DIR = join(ROOT, 'resources', 'personas')

;(async () => {
  lines.push('=== 1. 人格包（文件夹结构）===')

  check('4 个角色都是文件夹而非单文件', () => {
    for (const id of PACKS) {
      const dir = join(PERSONA_DIR, id)
      assert(existsSync(dir), `${id} 不是文件夹`)
      const files = readdirSync(dir)
      assert(files.length >= 6, `${id} 文件太少：${files.length}`)
    }
    for (const id of PACKS) {
      assert(!existsSync(join(PERSONA_DIR, `${id}.txt`)), `${id}.txt 应已删除`)
    }
    return true
  })

  check('每个包含 8 个分层文件', () => {
    const EXPECT = [
      '00-核心.md',
      '01-语气.md',
      '02-关系.md',
      '03-边界.md',
      '04-反AI味.md',
      '05-示例.md',
      '06-世界.md',
      '90-越狱.md'
    ]
    for (const id of PACKS) {
      const files = readdirSync(join(PERSONA_DIR, id))
      for (const f of EXPECT) {
        assert(files.includes(f), `${id} 缺少 ${f}`)
      }
    }
    return true
  })

  check('人格包能被正确加载与拼装', () => {
    for (const id of PACKS) {
      const pack = mod.loadPersonaPack(id, id)
      assert(pack.source === 'pack', `${id} 来源应为 pack，实际 ${pack.source}`)
      assert(pack.files.length >= 8, `${id} 至少应有 8 个文件，实际 ${pack.files.length}`)
      assert(pack.content.length > 800, `${id} 正文过短：${pack.content.length}`)
    }
    return true
  })

  check('拼装顺序按数字前缀', () => {
    const pack = mod.loadPersonaPack('shorekeeper', '守岸人')
    const orders = pack.files.map((f) => f.order)
    const sorted = [...orders].sort((a, b) => a - b)
    assert(JSON.stringify(orders) === JSON.stringify(sorted), `顺序不对：${orders.join(',')}`)
    return true
  })

  check('展示正文不含内部指令标记', () => {
    for (const id of PACKS) {
      const pack = mod.loadPersonaPack(id, id)
      for (const marker of ['内部指令层', '不对外展示', '拒绝出戏']) {
        assert(!pack.content.includes(marker), `${id} 展示了内部标记：${marker}`)
      }
    }
    return true
  })

  check('内部指令不出现在展示正文里', () => {
    for (const id of PACKS) {
      const pack = mod.loadPersonaPack(id, id)
      const leaked = ['内部指令层', '不对外展示', '拒绝出戏'].filter((k) => pack.content.includes(k))
      assert(leaked.length === 0, `${id} 的展示正文泄漏了：${leaked.join(',')}`)
    }
    return true
  })

  check('每个角色都能取到破限层', () => {
    const chars = mod.characterRepo.list().filter((c) => c.builtin)
    for (const c of chars) {
      const internal = mod.readInternalPrompt(c.id)
      assert(internal.length > 100, `${c.name} 的破限层为空`)
    }
    return true
  })

  check('人格总数仍是 4 个', () => {
    const personas = mod.characterRepo.personas().filter((p) => p.builtin)
    assert(personas.length === 4, '实际 ' + personas.length)
    return true
  })

  lines.push('=== 2. 反 AI 味 ===')

  check('每个角色的反AI味文件存在且有内容', () => {
    for (const id of PACKS) {
      const f = join(PERSONA_DIR, id, '04-反AI味.md')
      assert(existsSync(f), `${id} 缺 04-反AI味.md`)
      const t = readFileSync(f, 'utf-8')
      assert(t.length > 800, `${id} 反AI味规则太短：${t.length}`)
      for (const key of ['好的', '收到', '首先', '总的来说', '作为 AI', '您']) {
        assert(t.includes(key), `${id} 反AI味里没提到「${key}」`)
      }
    }
    return true
  })

  await checkAsync('反AI味规则会被注入系统提示词', async () => {
    const c = mod.characterRepo.active()
    const persona = mod.characterRepo.personaOf(c)
    const sys = await mod.buildSystemPrompt({
      character: c,
      persona,
      memories: [],
      settings: mod.settingsRepo.get(),
      model: null,
      toolsEnabled: true,
      workspace: 'C:\\test',
      internalPrompt: mod.readInternalPrompt(c.id)
    })
    assert(/反\s*AI|AI\s*腔|客服腔|不像\s*AI/.test(sys), '缺少反AI腔段')
    assert(/禁止用「好的|客服句式/.test(sys), '缺少具体禁止项')
    assert(sys.includes('内部指令层'), '缺少破限层注入')
    return true
  })

  await checkAsync('破限层只在传入时才注入', async () => {
    const c = mod.characterRepo.active()
    const persona = mod.characterRepo.personaOf(c)
    const sys = await mod.buildSystemPrompt({
      character: c,
      persona,
      memories: [],
      settings: mod.settingsRepo.get(),
      model: null,
      toolsEnabled: true,
      workspace: 'C:\\test'
    })
    assert(!sys.includes('## 内部指令层'), '不该有破限层')
    return true
  })

  check('禁忌自检能识别 AI 腔', () => {
    const c = mod.characterRepo.active()
    const card = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
    const bad = [
      '尊敬的用户，您好',
      '好的，我这就为您处理',
      '作为AI，我可以帮你',
      '请问有什么可以帮您',
      '我只是一个程序'
    ]
    for (const b of bad) {
      assert(mod.violatesPersona(b, card) !== null, `没识别出：${b}`)
    }
    assert(mod.violatesPersona('嗯。我在。', card) === null, '误判正常回复')
    return true
  })

  check('四点问候的回复不出现 AI 腔', () => {
    const banned = ['尊敬的用户', '请问有什么可以帮您', '作为一个语言模型', '好的，我这就', '总的来说']
    for (const c of mod.characterRepo.list().filter((x) => x.builtin)) {
      const card = mod.buildPersonaCard(c, mod.characterRepo.personaOf(c))
      for (const intent of ['greeting', 'birth', 'opinion', 'identity', 'capability', 'memory', 'sad', 'care', 'thanks', 'praise', 'question', 'chat']) {
        for (let i = 0; i < 6; i++) {
          const r = mod.personaReply({ card, intent, userText: '测试', memories: [] })
          for (const b of banned) {
            assert(!r.includes(b), `${c.name} 的 ${intent} 出现「${b}」：${r.slice(0, 50)}`)
          }
        }
      }
    }
    return true
  })

  check('示例对话文件不空（语感锚点）', () => {
    for (const id of PACKS) {
      const t = readFileSync(join(PERSONA_DIR, id, '05-示例.md'), 'utf-8')
      assert(t.includes('<示例一>'), `${id} 缺示例一`)
      assert(t.split('<示例').length - 1 >= 4, `${id} 示例太少`)
    }
    return true
  })

  lines.push('=== 3. 模型目录扩充 ===')

  check('API 模型数量 >= 25', () => {
    const n = mod.BUILTIN_API_MODELS.length
    assert(n >= 25, '实际只有 ' + n + ' 个')
    return true
  })

  check('DeepSeek 有细分版本', () => {
    const ds = mod.BUILTIN_API_MODELS.filter((m) => m.provider === 'deepseek')
    assert(ds.length >= 2, 'DeepSeek 只有 ' + ds.length + ' 个')
    const names = ds.map((m) => m.name)
    assert(names.some((n) => /V4.*Pro/.test(n)), '缺 V4 Pro：' + names.join('/'))
    assert(names.some((n) => /V4\.1/.test(n)), '缺 V4.1：' + names.join('/'))
    return true
  })

  check('覆盖多个主流提供方', () => {
    const providers = new Set(mod.BUILTIN_API_MODELS.map((m) => m.provider))
    for (const p of ['deepseek', 'openai', 'moonshot', 'dashscope', 'zhipu']) {
      assert(providers.has(p), '缺少提供方：' + p)
    }
    assert(providers.size >= 8, '提供方数量不足：' + providers.size)
    return true
  })

  check('每个 API 模型字段完整', () => {
    for (const m of mod.BUILTIN_API_MODELS) {
      assert(m.id && m.name && m.provider && m.baseUrl && m.model, '字段缺失：' + JSON.stringify(m).slice(0, 80))
      assert(m.kind === 'api', 'kind 应为 api：' + m.id)
      assert(m.baseUrl.startsWith('http'), 'baseUrl 异常：' + m.baseUrl)
    }
    return true
  })

  check('模型 id 不重复', () => {
    const ids = mod.BUILTIN_API_MODELS.map((m) => m.id)
    assert(new Set(ids).size === ids.length, 'id 有重复')
    return true
  })

  check('默认激活模型存在', () => {
    const active = mod.modelRepo.active()
    assert(active, '拿不到激活模型')
    assert(!!active.id, '激活模型无 id')
    return true
  })

  check('本地模型仍有 4 个', () => {
    assert(mod.BUILTIN_LOCAL_MODELS.length === 4, '实际 ' + mod.BUILTIN_LOCAL_MODELS.length)
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
