/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify14')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V14_DATA
const path = require('node:path')
module.exports = {
  app: {
    getPath: (k) => {
      const map = {
        userData: D, home: D,
        desktop: path.join(D, 'Desktop'), documents: path.join(D, 'Documents'),
        downloads: path.join(D, 'Downloads'), pictures: path.join(D, 'Pictures'),
        music: path.join(D, 'Music'), videos: path.join(D, 'Videos')
      }
      return map[k] || D
    },
    getAppPath: () => process.env.V14_APP,
    getVersion: () => '0.21.0'
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
export * from '${slash(join(ROOT, 'src/main/toolKit'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v14-'))
process.env.V14_DATA = DATA
process.env.V14_APP = ROOT
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

const EXPECTED = [
  'ask_user', 'fs_append', 'fs_copy', 'fs_delete', 'fs_docx_create', 'fs_docx_replace',
  'fs_edit', 'fs_glob', 'fs_list', 'fs_move', 'fs_read', 'fs_roots', 'fs_search',
  'fs_sheet_write', 'fs_stat', 'fs_write', 'goal_get', 'goal_set', 'image_understand',
  'job_kill', 'job_list', 'job_output', 'plan_enter', 'present_files', 'ralph_run', 'shell_job',
  'shell_run', 'skill_load', 'subagent_run', 'todo_write', 'web_fetch', 'web_search',
  'workflow_run'
]

;(async () => {
  lines.push('=== 1. 注册表覆盖 ===')

  check('工具全部注册（' + EXPECTED.length + ' 个）', () => {
    const names = mod.registry.names()
    for (const n of EXPECTED) {
      assert(names.includes(n), '缺少工具：' + n)
    }
    return true
  })

  check('没有多余工具', () => {
    const names = mod.registry.names()
    const extra = names.filter((n) => !EXPECTED.includes(n))
    assert(extra.length === 0, '多出：' + extra.join(','))
    return true
  })

  check('AGENT_TOOLS 与注册表一致', () => {
    assert(mod.AGENT_TOOLS.length === mod.registry.size, `不一致：${mod.AGENT_TOOLS.length} vs ${mod.registry.size}`)
    return true
  })

  lines.push('')
  lines.push('=== 2. 工具定义完整性 ===')

  check('每个工具都有元信息', () => {
    for (const def of mod.registry.all()) {
      assert(def.name, '缺 name')
      assert(def.displayName, def.name + ' 缺 displayName')
      assert(def.description, def.name + ' 缺 description')
      assert(def.category, def.name + ' 缺 category')
      assert(def.permission, def.name + ' 缺 permission')
      assert(Array.isArray(def.params), def.name + ' 缺 params')
      assert(typeof def.execute === 'function', def.name + ' 缺 execute')
    }
    return true
  })

  check('agentToolSpec 仍可用（对外兼容）', () => {
    const spec = mod.agentToolSpec('fs_read')
    assert(spec && spec.name === 'fs_read', 'agentToolSpec 失效')
    assert(spec.displayName === '读取文件', 'displayName 不对：' + spec.displayName)
    return true
  })

  check('工具定义分成了独立模块', () => {
    assert(existsSync(join(ROOT, 'src/main/toolKit.ts')), '没有 toolKit.ts')
    assert(existsSync(join(ROOT, 'src/main/tools/fsTools.ts')), '没有 fsTools.ts')
    assert(existsSync(join(ROOT, 'src/main/tools/shellTools.ts')), '没有 shellTools.ts')
    assert(existsSync(join(ROOT, 'src/main/tools/agentTools2.ts')), '没有 agentTools2.ts')
    assert(existsSync(join(ROOT, 'src/main/jobsStore.ts')), '没有 jobsStore.ts')
    return true
  })

  lines.push('')
  lines.push('=== 3. 参数校验 ===')

  check('缺必填参数会报错', () => {
    const def = mod.registry.get('fs_read')
    let threw = false
    try {
      mod.validateArgs(def, {})
    } catch (e) {
      threw = true
      assert(/必填/.test(e.message), '错误信息不对：' + e.message)
    }
    assert(threw, '应该报错')
    return true
  })

  check('参数完整时通过', () => {
    const def = mod.registry.get('fs_read')
    mod.validateArgs(def, { path: 'a.txt' })
    return true
  })

  check('类型不符会报错', () => {
    const def = mod.registry.get('fs_read')
    let threw = false
    try {
      mod.validateArgs(def, { path: 'a.txt', offset: {} })
    } catch (e) {
      threw = true
    }
    assert(threw, '类型错误应该被拦')
    return true
  })

  lines.push('')
  lines.push('=== 4. 事件总线 ===')

  check('可以挂 before 监听器并拦截', async () => {
    const bus = new mod.ToolBus()
    let called = 0
    bus.onBefore(() => {
      called++
      return { action: 'deny', reason: '测试拦截' }
    })
    const v = await bus.runBefore({ name: 'fs_read', args: {}, phase: 'before' })
    assert(called === 1, '监听器没被调用')
    assert(v?.action === 'deny', '拦截没生效')
    return true
  })

  check('before 链短路（第一个表态即返回）', async () => {
    const bus = new mod.ToolBus()
    let second = 0
    bus.onBefore(() => ({ action: 'allow' }))
    bus.onBefore(() => {
      second++
      return undefined
    })
    await bus.runBefore({ name: 'x', args: {}, phase: 'before' })
    assert(second === 0, '第二个监听器不该被调用')
    return true
  })

  check('after / error 监听器抛错不影响主流程', async () => {
    const bus = new mod.ToolBus()
    bus.onAfter(() => {
      throw new Error('故意抛错')
    })
    await bus.emitAfter({ name: 'x', args: {}, outcome: {}, durationMs: 1, phase: 'after' })
    return true
  })

  check('全局总线已导出', () => {
    assert(mod.toolBus, '没有全局 toolBus')
    const st = mod.toolBus.stats()
    assert(typeof st.before === 'number', 'stats 不对')
    return true
  })

  lines.push('')
  lines.push('=== 5. 执行链路 ===')

  check('fs_read 能读文件', async () => {
    const f = join(DATA, 'hello.txt')
    writeFileSync(f, '注册表改造测试内容', 'utf-8')
    mod.setMachinePermission('view')
    const r = await mod.runAgentTool('fs_read', { path: f })
    assert(String(r.context).includes('注册表改造测试内容'), '没读到内容：' + r.summary)
    return true
  })

  check('未知工具报错清晰', async () => {
    let threw = false
    try {
      await mod.runAgentTool('not_a_tool', {})
    } catch (e) {
      threw = true
      assert(/未知工具/.test(e.message), '错误信息不对：' + e.message)
    }
    assert(threw, '应该报错')
    return true
  })

  check('toolBus 挂在执行链路上', () => {
    const src = read('src/main/agentTools.ts')
    assert(src.includes('toolBus.runBefore'), 'runAgentTool 没走 before 链')
    assert(src.includes('toolBus.emitAfter'), 'runAgentTool 没广播 after')
    assert(src.includes('toolBus.emitError'), 'runAgentTool 没广播 error')
    return true
  })

  check('agentTools 行数下降（拆分生效）', () => {
    const n = read('src/main/agentTools.ts').split('\n').length
    assert(n < 1200, `还是 ${n} 行，没瘦身`)
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
