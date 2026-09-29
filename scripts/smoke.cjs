/**
 *
 *   node scripts/smoke.cjs
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.smoke')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'electron-stub.cjs')
writeFileSync(
  STUB,
  `
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const DATA = process.env.SMOKE_DATA_DIR
module.exports = {
  app: {
    getPath: () => DATA,
    getVersion: () => '0.1.0-smoke'
  },
  shell: {
    openPath: async (p) => (fs.existsSync(p) ? '' : 'ENOENT: ' + p),
    openExternal: async () => true
  },
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
export { JsonStore, uid } from '${slash(join(ROOT, 'src/main/store'))}'
export * from '${slash(join(ROOT, 'src/main/permission'))}'
export * from '${slash(join(ROOT, 'src/main/workspaceSecurity'))}'
export * from '${slash(join(ROOT, 'src/main/memory'))}'
export * from '${slash(join(ROOT, 'src/main/agent'))}'
export * from '${slash(join(ROOT, 'src/main/apps'))}'
export * from '${slash(join(ROOT, 'src/main/hardware'))}'
export * from '${slash(join(ROOT, 'src/main/llm'))}'
export * from '${slash(join(ROOT, 'src/main/personaCard'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
`,
  'utf-8'
)

const esbuild = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild')
execFileSync(
  process.execPath,
  [
    esbuild,
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

const DATA = mkdtempSync(join(tmpdir(), 'aimis-smoke-'))
process.env.SMOKE_DATA_DIR = DATA

const mod = require(join(OUT, 'bundle.cjs'))

   否则默认 view 档会拦截写/执行类工具，测试无法覆盖这些路径 */
try {
  mod.setMachinePermission?.('full')
} catch {
}
try {
  mod.installApprovalPrompt?.(async () => 'once')
} catch {
}
try {
  const ws = mod.getWorkspace?.()
  if (ws) mod.setWorkspaceTrust?.(ws, true)
} catch {
}

let pass = 0
let fail = 0
const results = []

function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    results.push('  PASS  ' + name)
  } catch (err) {
    fail++
    results.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

async function checkAsync(name, fn) {
  try {
    const r = await fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    results.push('  PASS  ' + name)
  } catch (err) {
    fail++
    results.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

;(async () => {
  results.push('=== 1. JsonStore 读写与原子性 ===')
  check('写入后能读回（mutator 就地修改生效）', () => {
    const s = new mod.JsonStore('t1', () => ({ items: [] }))
    s.update((d) => {
      d.items.push('a')
    })
    const back = s.read()
    assert(back.items.length === 1, '就地修改未生效，长度=' + back.items.length)
    s.update((d) => {
      d.items.push('b')
    })
    assert(s.read().items.length === 2, '第二次写入丢失')
    return true
  })

  check('mutator 返回新对象时采用返回值', () => {
    const s = new mod.JsonStore('t2', () => ({ n: 1 }))
    s.update(() => ({ n: 42 }))
    assert(s.read().n === 42, '返回值未被采用')
    return true
  })

  check('落盘文件真实存在且可解析', () => {
    const s = new mod.JsonStore('t3', () => ({ v: 0 }))
    s.update((d) => {
      d.v = 7
    })
    const raw = JSON.parse(readFileSync(s.path, 'utf-8'))
    assert(raw.v === 7, '磁盘内容不对')
    return true
  })

  results.push('=== 2. 记忆层：写入 / 检索 / 命中计数 ===')
  check('写入记忆', () => {
    mod.memoryRepo.add({ text: '我的显卡是 RTX 4060', characterId: 'c1', weight: 0.72 })
    mod.memoryRepo.add({ text: '我住在杭州，习惯晚上工作', characterId: 'c1', weight: 0.72 })
    assert(mod.memoryRepo.list('c1').length === 2, '记忆未写入')
    return true
  })

  check('新记忆默认落到「事件」，不再有「事实」分类', () => {
    const list = mod.memoryRepo.list('c1')
    assert(list.every((m) => m.kind !== 'fact'), '仍有记忆落在已下线的 fact 分类')
    assert(list.every((m) => m.kind === 'event'), '默认分类不是 event：' + list.map((m) => m.kind).join(','))
    return true
  })

  check('显式传 kind: fact 也会被归一到「事件」', () => {
    const item = mod.memoryRepo.add({ text: '我习惯深夜写代码', characterId: 'c1', kind: 'fact', weight: 0.5 })
    assert(item.kind === 'event', 'fact 未被归一：' + item.kind)
    mod.memoryRepo.delete(item.id)
    return true
  })

  check('旧「诞生记忆」被一次性清理掉', () => {
    mod.memoryStore.update((s) => {
      s.items.push({
        id: 'mem_seed_fixture',
        kind: 'seed',
        text: '守岸人诞生于这台电脑：名字、人格、声音和头像都是用户一点点定下来的，她住在这里陪用户干活、聊天、听歌。',
        characterId: 'c1',
        weight: 1,
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        tags: []
      })
    })
    assert(mod.memoryRepo.list('c1').length === 3, '种子记忆未插入')
    const r = mod.purgeSeedMemories()
    assert(r.removed === 1, '清理条数不对：' + r.removed)
    assert(mod.memoryRepo.list('c1').length === 2, '种子记忆未被删除')
    assert(!mod.memoryRepo.list('c1').some((m) => m.kind === 'seed'), '仍有 seed 残留')
    return true
  })

  check('清理是幂等的（再跑一次没有任何改动）', () => {
    const r = mod.purgeSeedMemories()
    assert(r.removed === 0 && r.normalized === 0, '第二次清理仍有改动：' + JSON.stringify(r))
    assert(mod.memoryRepo.list('c1').length === 2, '记忆数量被改动')
    return true
  })

  check('历史「事实」记忆被归一成「事件」而不是删除', () => {
    mod.memoryStore.update((s) => {
      s.items.push({
        id: 'mem_fact_fixture',
        kind: 'fact',
        text: '我养了一只叫团子的猫',
        characterId: 'c1',
        weight: 0.6,
        hits: 0,
        createdAt: Date.now(),
        lastHitAt: null,
        tags: []
      })
    })
    const r = mod.purgeSeedMemories()
    assert(r.normalized === 1, '归一数量不对：' + r.normalized)
    const cat = mod.memoryRepo.list('c1').find((m) => m.text.includes('团子'))
    assert(cat, '归一后记忆被误删')
    assert(cat.kind === 'event', 'fact 未归一成 event：' + cat.kind)
    return true
  })

  check('按相关度检索：问「显卡」能命中显卡记忆', () => {
    const hit = mod.memoryRepo.search('我的显卡怎么样', 'c1', 3)
    assert(hit.length > 0, '没有检索结果')
    const top = hit[0].text
    assert(top.includes('显卡'), 'top1 不是显卡记忆，而是：' + top)
    return true
  })

  check('检索不再召回已清理的 seed 记忆', () => {
    const hit = mod.memoryRepo.search('你是怎么诞生的', 'c1', 3)
    assert(!hit.some((m) => m.kind === 'seed'), 'seed 记忆仍被召回')
    return true
  })

  check('角色隔离：c2 查不到 c1 的记忆', () => {
    assert(mod.memoryRepo.list('c2').length === 0, '角色隔离失效')
    return true
  })

  check('命中计数递增', () => {
    const before = mod.memoryRepo.list('c1').find((m) => m.text.includes('显卡'))
    const n0 = before.hits
    mod.memoryRepo.search('显卡温度', 'c1', 3)
    const after = mod.memoryRepo.list('c1').find((m) => m.text.includes('显卡'))
    assert(after.hits > n0, 'hits 未递增')
    return true
  })

  check('删除记忆', () => {
    const list = mod.memoryRepo.list('c1')
    const target = list.find((m) => m.text.includes('杭州'))
    mod.memoryRepo.delete(target.id)
    assert(mod.memoryRepo.list('c1').length === 2, '删除失败')
    return true
  })

  results.push('=== 3. 记忆自动识别 ===')
  check('「我叫小明」被判定为值得记', () => assert(mod.looksMemorable('我叫小明') === true))
  check('「我喜欢安静的歌」被判定为值得记', () => assert(mod.looksMemorable('我喜欢安静的歌') === true))
  check('「记住我明天要交作业」被判定为值得记', () => assert(mod.looksMemorable('记住我明天要交作业') === true))
  check('「我住在杭州」被判定为值得记', () => assert(mod.looksMemorable('我住在杭州') === true))
  check('「今天天气不错」不被误判', () => assert(mod.looksMemorable('今天天气不错') === false))
  check('「守岸人 看下我的电脑状态」不被误记为记忆', () =>
    assert(mod.looksMemorable('守岸人 看下我的电脑状态') === false, '指令句被误判为记忆'))
  check('「打开网易云音乐」不被误记为记忆', () =>
    assert(mod.looksMemorable('打开网易云音乐') === false, '指令句被误判为记忆'))
  check('「帮我看下显卡温度」不被误记为记忆', () =>
    assert(mod.looksMemorable('帮我看下显卡温度') === false, '指令句被误判为记忆'))
  check('「我的显卡是 RTX 4060」仍被判定为值得记', () =>
    assert(mod.looksMemorable('我的显卡是 RTX 4060') === true, '事实陈述被误杀'))
  check('「我叫测试员，我的显卡是 RTX 4060」仍被判定为值得记', () =>
    assert(mod.looksMemorable('我叫测试员，我的显卡是 RTX 4060') === true, '事实陈述被误杀'))

  results.push('=== 4. 意图路由 ===')
  check('「看下我的电脑状态」-> get_hardware_status', () => {
    const i = mod.detectIntent('守岸人 看下我的电脑状态')
    assert(i && i.tool === 'get_hardware_status', '得到 ' + JSON.stringify(i))
    return true
  })
  check('「打开网易云音乐」-> launch_app(网易云音乐)', () => {
    const i = mod.detectIntent('守岸人 打开网易云音乐')
    assert(i && i.tool === 'launch_app', '工具不对: ' + JSON.stringify(i))
    assert(i.params.appName === '网易云音乐', '应用名不对: ' + JSON.stringify(i.params))
    return true
  })
  check('「帮我开一下记事本」-> launch_app(记事本)', () => {
    const i = mod.detectIntent('帮我开一下记事本')
    assert(i && i.tool === 'launch_app' && i.params.appName === '记事本', JSON.stringify(i))
    return true
  })
  check('「查看进程」-> list_processes', () => {
    const i = mod.detectIntent('看下现在什么进程在占内存')
    assert(i && i.tool === 'list_processes', JSON.stringify(i))
    return true
  })
  check('闲聊不触发工具', () => {
    const i = mod.detectIntent('你今天心情怎么样')
    assert(i === null, '误触发: ' + JSON.stringify(i))
    return true
  })

  results.push('=== 5. 工具执行 ===')
  await checkAsync('get_hardware_status 返回结构符合契约', async () => {
    const out = await mod.runTool('get_hardware_status', {})
    const s = out.result.snapshot
    assert(out.result.status === 'ok', 'status 不是 ok')
    assert(typeof s.timestamp === 'string' && s.timestamp.includes('T'), 'timestamp 格式不对')
    assert(typeof s.cpu.name === 'string' && s.cpu.name.length > 0, 'cpu.name 缺失')
    assert(typeof s.cpu.loadPercent === 'number', 'cpu.loadPercent 缺失')
    assert('temperatureC' in s.cpu, 'cpu.temperatureC 字段缺失')
    assert(typeof s.memory.totalGB === 'number', 'memory.totalGB 缺失')
    assert(typeof s.memory.usedPercent === 'number', 'memory.usedPercent 缺失')
    assert('gpu' in s, 'gpu 字段缺失')
    assert(typeof s.os.hostname === 'string', 'os.hostname 缺失')
    return true
  })

  await checkAsync('硬件结果能被口语化转述（含 CPU/内存关键词）', async () => {
    const out = await mod.runTool('get_hardware_status', {})
    const text = mod.offlineNarrate('get_hardware_status', {}, out.result)
    assert(text.includes('CPU'), '转述里没有 CPU')
    assert(text.includes('内存'), '转述里没有内存')
    assert(!text.includes('{'), '转述里混入了 JSON')
    return true
  })

  await checkAsync('launch_app 对不存在的应用返回 launched=false 且有提示', async () => {
    const out = await mod.runTool('launch_app', { appName: '这个软件肯定不存在xyz' })
    assert(out.result.launched === false, '不该声称启动成功')
    assert(out.result.resolvedPath === null, 'resolvedPath 应为 null')
    assert(out.result.message.length > 0, '缺少提示文案')
    const text = mod.offlineNarrate('launch_app', { appName: 'xyz' }, out.result)
    assert(text.length > 0, '转述为空')
    return true
  })

  await checkAsync('launch_app 能解析别名表里的真实路径', async () => {
    const alias = mod.resolveApp('网易云音乐')
    assert(alias !== null, '别名表未命中网易云音乐')
    assert(alias.display === '网易云音乐', '展示名不对')
    return true
  })

  await checkAsync('list_processes 返回进程数组', async () => {
    const out = await mod.runTool('list_processes', {})
    assert(Array.isArray(out.result.processes), 'processes 不是数组')
    assert(out.result.processes.length > 0, '进程列表为空')
    assert(typeof out.result.processes[0].Name === 'string', '进程缺 Name')
    return true
  })

  results.push('=== 6. 工具注册表契约 ===')
  check('工具均已注册且字段完整', () => {
    assert(mod.TOOL_SPECS.length >= 11, '工具数量=' + mod.TOOL_SPECS.length)
    for (const t of mod.TOOL_SPECS) {
      assert(t.name && t.displayName && t.actionLabel && t.description, '工具字段缺失: ' + t.name)
      assert(['once', 'always', 'deny'].includes(t.defaultPermission), '权限值非法: ' + t.name)
    }
    return true
  })
  check('核心工具齐全', () => {
    const names = mod.TOOL_SPECS.map((t) => t.name)
    for (const n of ['get_hardware_status', 'launch_app', 'open_path', 'list_processes', 'system_power']) {
      assert(names.includes(n), '缺少核心工具: ' + n)
    }
    return true
  })
  check('扩展工具齐全（磁盘/剪贴板/音量/截图/搜索）', () => {
    const names = mod.TOOL_SPECS.map((t) => t.name)
    for (const n of ['get_disk_usage', 'read_clipboard', 'write_clipboard', 'set_volume', 'take_screenshot', 'search_files']) {
      assert(names.includes(n), '缺少扩展工具: ' + n)
    }
    return true
  })
  check('get_hardware_status 免授权，launch_app 需授权（与视频一致）', () => {
    const hw = mod.TOOL_SPECS.find((t) => t.name === 'get_hardware_status')
    const la = mod.TOOL_SPECS.find((t) => t.name === 'launch_app')
    assert(hw.defaultPermission === 'always', '硬件读取应免授权')
    assert(la.defaultPermission === 'once', '启动应用应需授权')
    assert(la.description === 'Launches an approved local application.', '授权卡英文描述与视频不一致')
    return true
  })

  results.push('=== 6b. 扩展工具执行 ===')
  await checkAsync('get_disk_usage 返回磁盘数组', async () => {
    const out = await mod.runTool('get_disk_usage', {})
    assert(out.result.status === 'ok', 'status 不是 ok')
    assert(Array.isArray(out.result.drives), 'drives 不是数组')
    assert(out.result.drives.length > 0, '磁盘列表为空')
    assert(typeof out.result.drives[0].usedPercent === 'number', '缺少 usedPercent')
    const text = mod.offlineNarrate('get_disk_usage', {}, out.result)
    assert(text.length > 0 && !text.includes('{'), '转述异常: ' + text)
    return true
  })

  await checkAsync('read_clipboard 返回文本字段', async () => {
    const out = await mod.runTool('read_clipboard', {})
    assert(out.result.status === 'ok', 'status 不是 ok')
    assert(typeof out.result.text === 'string', '缺少 text')
    return true
  })

  await checkAsync('write_clipboard + read_clipboard 往返一致（含中文）', async () => {
    const probe = '守岸人陪伴终端·剪贴板往返测试 123'
    await mod.runTool('write_clipboard', { text: probe })
    const out = await mod.runTool('read_clipboard', {})
    assert(out.result.text.trim() === probe, '往返不一致，读到: ' + JSON.stringify(out.result.text.slice(0, 60)))
    return true
  })

  await checkAsync('search_files 对不存在的关键词返回 0 命中', async () => {
    const out = await mod.runTool('search_files', { keyword: 'zzz_不存在的文件_zzz', root: 'C:\\Windows\\System32\\drivers\\etc' })
    assert(out.result.count === 0, '不该有命中，实际: ' + out.result.count)
    const text = mod.offlineNarrate('search_files', {}, out.result)
    assert(text.includes('没找到'), '转述应说明没找到: ' + text)
    return true
  })

  results.push('=== 7. 离线引擎：人设驱动 ===')
  check('「你是怎么诞生的」命中招牌场景', () => {
    const card = mod.buildPersonaCard(
      { id: 'c', name: '守岸人', latinName: 'SHOREKEEPER', tagline: '', avatar: {}, personaId: 'p', voice: {}, greeting: '', builtin: true, createdAt: 0, updatedAt: 0 },
      { id: 'p', name: 'x', content: '你是守岸人。\n\n## 语气\n克制、安静、留白多。\n', source: 'builtin', builtin: true, updatedAt: 0 }
    )
    const text = mod.personaReply({ card, intent: 'birth', userText: '你是怎么诞生的？', memories: [] })
    assert(text.includes('搭起来') || text.includes('键盘') || text.includes('名字'), '回复不像诞生场景: ' + text.slice(0, 60))
    return true
  })
  check('「你觉得我人怎么样」命中招牌场景', () => {
    const card = mod.buildPersonaCard(
      { id: 'c', name: '流萤', latinName: 'FIREFLY', tagline: '', avatar: {}, personaId: 'p', voice: {}, greeting: '', builtin: true, createdAt: 0, updatedAt: 0 },
      { id: 'p', name: 'x', content: '你是流萤。\n\n## 语气\n温柔、干净、小心翼翼。\n', source: 'builtin', builtin: true, updatedAt: 0 }
    )
    const text = mod.personaReply({ card, intent: 'opinion', userText: '你觉得我人怎么样', memories: [] })
    assert(text.includes('突然') || text.includes('真诚') || text.includes('认真'), '回复不像该场景: ' + text.slice(0, 60))
    return true
  })
  check('记忆被自然注入回复', () => {
    const card = mod.buildPersonaCard(
      { id: 'c', name: '守岸人', latinName: 'SHOREKEEPER', tagline: '', avatar: {}, personaId: 'p', voice: {}, greeting: '', builtin: true, createdAt: 0, updatedAt: 0 },
      { id: 'p', name: 'x', content: '你是守岸人。\n\n## 语气\n克制、安静。\n', source: 'builtin', builtin: true, updatedAt: 0 }
    )
    let hit = false
    for (let i = 0; i < 20; i++) {
      const text = mod.personaReply({
        card,
        intent: 'greeting',
        userText: '你好',
        memories: [{ id: 'm', kind: 'event', text: '我住在杭州', characterId: 'c', weight: 1, hits: 0, createdAt: 0, lastHitAt: null, tags: [] }]
      })
      assert(text.length > 0, '回复为空')
      if (text.includes('杭州')) hit = true
    }
    assert(hit, '记忆没被注入回复')
    return true
  })

  results.push('=== 8. System Prompt 组装 ===')
  await checkAsync('包含人格 / 身份 / 记忆 / 环境 / 输出要求 五段', async () => {
    const sys = await mod.buildSystemPrompt({
      character: { id: 'c', name: '守岸人', latinName: 'SHOREKEEPER', tagline: '', avatar: {}, personaId: 'p', voice: {}, greeting: '', builtin: true, createdAt: 0, updatedAt: 0 },
      persona: { id: 'p', name: 'P', content: '你是守岸人，住在用户电脑里。', builtin: true, updatedAt: 0 },
      memories: [{ id: 'm', kind: 'event', text: '我住在杭州', characterId: 'c', weight: 1, hits: 0, createdAt: 0, lastHitAt: null, tags: [] }],
      settings: { llm: { provider: 'offline', baseUrl: '', apiKey: '', model: '', temperature: 1, maxTokens: 1, systemExtra: '' }, agent: { machinePermission: 'workspace' } }
    })
    assert(sys.includes('住在用户电脑里'), '缺少人格正文')
    assert(sys.includes('守岸人'), '缺少当前身份')
    assert(sys.includes('我住在杭州'), '缺少长期记忆')
    assert(sys.includes('Windows'), '缺少运行环境')
    assert(sys.includes('输出要求'), '缺少输出要求')
    return true
  })

  await checkAsync('工具结果被注入并附转述指令', async () => {
    const sys = await mod.buildSystemPrompt({
      character: { id: 'c', name: '守岸人', latinName: 'SHOREKEEPER', tagline: '', avatar: {}, personaId: 'p', voice: {}, greeting: '', builtin: true, createdAt: 0, updatedAt: 0 },
      persona: { id: 'p', name: 'P', content: 'x', source: 'builtin', builtin: true, updatedAt: 0 },
      memories: [],
      settings: { llm: { provider: 'offline', baseUrl: '', apiKey: '', model: '', temperature: 1, maxTokens: 1, systemExtra: '' }, agent: { machinePermission: 'workspace' } },
      toolContext: '{"cpu":{"loadPercent":8}}'
    })
    assert(sys.includes('工具执行结果'), '缺少工具结果段')
    assert(sys.includes('loadPercent'), '工具结果内容缺失')
    assert(sys.includes('不要念 JSON'), '缺少转述指令')
    return true
  })

  console.log('\n' + results.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('  临时数据目录: ' + DATA)
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((err) => {
  console.error('冒烟测试崩溃:', err)
  process.exit(2)
})
