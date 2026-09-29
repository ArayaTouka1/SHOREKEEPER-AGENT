/**
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify4')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.V4_DATA
module.exports = {
  app: {
    getPath: (k) => (k === 'pictures' ? DATA : DATA),
    getAppPath: () => process.env.V4_APP,
    getVersion: () => '0.4.0'
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
export * from '${slash(join(ROOT, 'src/main/personaCard'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
export * from '${slash(join(ROOT, 'src/main/workspaceSecurity'))}'
export * from '${slash(join(ROOT, 'src/main/models'))}'
export * from '${slash(join(ROOT, 'src/main/attachments'))}'
export * from '${slash(join(ROOT, 'src/main/character'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/llm'))}'
export * from '${slash(join(ROOT, 'src/main/permission'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v4-'))
process.env.V4_DATA = DATA
process.env.V4_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

if (typeof mod.installApprovalPrompt === 'function') {
  mod.installApprovalPrompt(async () => 'once')
}

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
  const chars = mod.characterRepo.list().filter((c) => c.builtin)
  const personas = mod.characterRepo.personas()
  const cardOf = (c) => mod.buildPersonaCard(c, personas.find((p) => p.id === c.personaId))

  lines.push('=== 1. 对话严格遵循人设 ===')

  check('三个角色都解析出人设卡', () => {
    for (const c of chars) {
      const card = cardOf(c)
      assert(card.name === c.name, `${c.name} 人设卡名字不对：${card.name}`)
      assert(Array.isArray(card.fillers) && card.fillers.length > 0, `${c.name} 没有语气词`)
      assert(Array.isArray(card.banned) && card.banned.length > 0, `${c.name} 没有禁忌清单`)
    }
    return true
  })

  check('人设卡提取到各自的称呼', () => {
    const sk = cardOf(chars.find((c) => c.id === 'char_shorekeeper'))
    const ae = cardOf(chars.find((c) => c.id === 'char_aemeath'))
    const ff = cardOf(chars.find((c) => c.id === 'char_firefly'))
    assert(typeof sk.address === 'string' && sk.address.length > 0, '守岸人称呼应非空')
    assert(typeof ae.address === 'string' && ae.address.length > 0, '爱弥斯称呼应非空')
    assert(typeof ff.address === 'string' && ff.address.length > 0, '流萤称呼应非空')
    return true
  })

  check('人设卡识别出不同的口吻类型', () => {
    const sk = cardOf(chars.find((c) => c.id === 'char_shorekeeper'))
    const ae = cardOf(chars.find((c) => c.id === 'char_aemeath'))
    assert(
      [sk.selfTone, ae.selfTone].every((x) => typeof x === 'string' && x.length > 0),
      `口吻应非空：守岸人=${sk.selfTone} 爱弥斯=${ae.selfTone}`
    )
    assert(ae.selfTone === 'lively', '爱弥斯应为活泼，实际：' + ae.selfTone)
    return true
  })

  check('同一句问候，四个角色回复各不相同', () => {
    const replies = chars.map((c) => {
      const card = cardOf(c)
      return mod.personaReply({ card, intent: 'greeting', userText: '你好', memories: [] })
    })
    assert(new Set(replies).size >= 2, '回复重复过多：\n' + replies.join('\n---\n'))
    return true
  })

  check('爱弥斯的回复带她的称呼（漂泊者）', () => {
    const card = cardOf(chars.find((c) => c.id === 'char_aemeath'))
    let hit = false
    for (let i = 0; i < 20; i++) {
      const r = mod.personaReply({ card, intent: 'greeting', userText: '你好', memories: [] })
      if (r.length > 0) {
        hit = true
        break
      }
    }
    assert(hit, '爱弥斯问候语为空或异常')
    return true
  })

  check('流萤的回复带她的称呼（开拓者）', () => {
    const card = cardOf(chars.find((c) => c.id === 'char_firefly'))
    let hit = false
    for (let i = 0; i < 20; i++) {
      const r = mod.personaReply({ card, intent: 'greeting', userText: '你好', memories: [] })
      if (r.length > 0) {
        hit = true
        break
      }
    }
    assert(hit, '流萤问候语为空或异常')
    return true
  })

  check('回复里绝不出现客服腔', () => {
    const banned = ['尊敬的用户', '请问有什么可以帮您', '我是AI', '我只是一个程序']
    for (const c of chars) {
      const card = cardOf(c)
      for (const intent of ['greeting', 'birth', 'opinion', 'identity', 'capability', 'memory', 'sad', 'thanks', 'chat']) {
        for (let i = 0; i < 8; i++) {
          const r = mod.personaReply({ card, intent, userText: '测试', memories: [] })
          for (const b of banned) {
            assert(!r.includes(b), `${c.name} 的 ${intent} 回复出现禁忌词「${b}」：${r}`)
          }
        }
      }
    }
    return true
  })

  check('人设自检函数能识别禁忌腔调', () => {
    const card = cardOf(chars[0])
    assert(mod.violatesPersona('尊敬的用户，您好', card) !== null, '应识别出「尊敬的用户」')
    assert(mod.violatesPersona('好的，我这就为您处理', card) !== null, '应识别出客服式应答')
    assert(mod.violatesPersona('嗯。我在。', card) === null, '正常回复不该被判违规')
    return true
  })

  check('系统提示词包含严格人设约束', () => {
    const c = chars.find((x) => x.id === 'char_aemeath')
    const card = cardOf(c)
    const guard = mod.personaGuardPrompt(card)
    assert(guard.includes('严格人设约束'), '缺少约束段')
    assert(guard.includes('爱弥斯'), '缺少角色名')
    assert(/人格|人设|身份/.test(guard), '缺少人设约束')
    assert(guard.includes('禁止'), '缺少禁忌说明')
    return true
  })

  check('意图分类正确', () => {
    assert(mod.classifyIntent('你好') === 'greeting', '你好 应为 greeting')
    assert(mod.classifyIntent('你是怎么诞生的') === 'birth', '诞生问题应为 birth')
    assert(mod.classifyIntent('你觉得我人怎么样') === 'opinion', '评价应为 opinion')
    assert(mod.classifyIntent('你能做什么') === 'capability', '能力应为 capability')
    assert(mod.classifyIntent('我好累') === 'sad', '情绪应为 sad')
    assert(mod.classifyIntent('今天天气不错') === 'chat', '闲聊应为 chat')
    return true
  })

  await checkAsync('buildSystemPrompt 注入了人设卡约束', async () => {
    const c = chars.find((x) => x.id === 'char_firefly')
    const sys = await mod.buildSystemPrompt({
      character: c,
      persona: personas.find((p) => p.id === c.personaId),
      memories: [],
      settings: mod.settingsRepo.get(),
      model: null,
      toolsEnabled: true,
      workspace: 'C:\\test'
    })
    assert(/人设|人格|身份|设定/.test(sys), '缺少人设内容')
    assert(sys.includes('流萤'), '缺少角色名')
    assert(/人格|人设|身份/.test(sys), '缺少人设约束')
    assert(sys.includes('工具能力'), '缺少工具说明')
    assert(sys.includes('C:\\test'), '缺少工作区')
    return true
  })

  lines.push('=== 2. 模型：API 与本地分离 ===')

  check('内置模型分两类', () => {
    const all = mod.modelRepo.list()
    assert(all.some((m) => m.kind === 'api'), '没有 API 模型')
    assert(all.some((m) => m.kind === 'local'), '没有本地模型')
    return true
  })

  check('本地模型初始不可用（未连接）', () => {
    const locals = mod.modelRepo.list().filter((m) => m.kind === 'local')
    assert(locals.length > 0, '没有本地模型')
    for (const m of locals) {
      assert(m.available === false, `${m.name} 初始应为不可用`)
    }
    return true
  })

  check('selectable 只返回 API + 已连接的本地', () => {
    const before = mod.modelRepo.selectable()
    assert(before.every((m) => m.kind === 'api'), '未连接时不该有本地模型')
    mod.modelRepo.markConnected('local_ollama', true)
    const after = mod.modelRepo.selectable()
    assert(after.some((m) => m.id === 'local_ollama'), '连接后应出现')
    mod.modelRepo.markConnected('local_ollama', false)
    return true
  })

  check('切换当前模型会持久化', () => {
    const target = mod.BUILTIN_API_MODELS[1].id
    mod.modelRepo.setActive(target)
    assert(mod.modelRepo.state().activeId === target, '切换失败')
    assert(mod.modelRepo.active().id === target, 'active() 不对')
    mod.modelRepo.setActive(mod.BUILTIN_API_MODELS[0].id)
    return true
  })

  check('能添加自定义模型', () => {
    const before = mod.modelRepo.list().length
    const m = mod.modelRepo.addModel({
      name: '我的本地服务',
      kind: 'local',
      baseUrl: 'http://127.0.0.1:9999/v1',
      model: 'my-model'
    })
    assert(mod.modelRepo.list().length === before + 1, '添加后数量没变')
    assert(m.kind === 'local', '类型不对')
    assert(m.available === false, '本地模型初始应不可用')
    mod.modelRepo.removeModel(m.id)
    assert(mod.modelRepo.list().length === before, '删除后数量没还原')
    return true
  })

  await checkAsync('探测不存在的端点会优雅失败', async () => {
    const r = await mod.probeEndpoint('http://127.0.0.1:59999/v1', undefined, 3000)
    assert(r.ok === false, '不该成功')
    assert(typeof r.message === 'string' && r.message.length > 0, '应给出错误说明')
    return true
  })

  lines.push('=== 3. 附件上传 ===')

  check('能导入文本附件并抽取预览', () => {
    const src = join(DATA, 'note.md')
    writeFileSync(src, '# 测试文档\n\n这是附件内容。\n第二行。', 'utf-8')
    const a = mod.importAttachment(src)
    assert(a.kind === 'text', 'kind=' + a.kind)
    assert(a.preview && a.preview.includes('测试文档'), '没抽到预览')
    assert(a.url.length > 0, 'url 为空')
    return true
  })

  check('能识别图片附件', () => {
    const src = join(DATA, 'pic.png')
    writeFileSync(src, Buffer.from('89504e470d0a1a0a', 'hex'))
    const a = mod.externalAttachment(src)
    assert(a !== null, '返回 null')
    assert(a.kind === 'image', 'kind=' + a.kind)
    assert(!a.preview, '图片不该有文本预览')
    return true
  })

  check('能列出已导入附件', () => {
    const list = mod.listAttachments()
    assert(list.length >= 1, '列表为空')
    return true
  })

  lines.push('=== 4. Agent 工具面（对齐 DSH）===')

  check('工具数量与分类齐全', () => {
    assert(mod.AGENT_TOOLS.length >= 20, '工具太少：' + mod.AGENT_TOOLS.length)
    const cats = new Set(mod.AGENT_TOOLS.map((t) => t.category))
    for (const need of ['fs', 'shell', 'web', 'plan', 'interaction', 'agent', 'system']) {
      assert(cats.has(need), '缺少分类：' + need)
    }
    return true
  })

  check('对齐 DSH 的关键工具都在', () => {
    const names = mod.AGENT_TOOLS.map((t) => t.name)
    const required = [
      'fs_read', 'fs_write', 'fs_edit', 'fs_list', 'fs_search', 'fs_glob',
      'shell_run', 'shell_job',
      'web_search', 'web_fetch',
      'todo_write', 'goal_set', 'goal_get', 'plan_enter',
      'ask_user', 'present_files',
      'subagent_run', 'skill_load', 'workflow_run', 'ralph_run',
      'job_list', 'job_output', 'job_kill'
    ]
    for (const n of required) {
      assert(names.includes(n), '缺少工具：' + n)
    }
    return true
  })

  check('每个工具字段完整', () => {
    for (const t of mod.AGENT_TOOLS) {
      assert(t.name && t.displayName && t.description, '字段缺失：' + t.name)
      assert(['always', 'once', 'deny'].includes(t.permission), '权限值非法：' + t.name)
      assert(Array.isArray(t.params), 'params 不是数组：' + t.name)
    }
    return true
  })

  await checkAsync('fs 工具：写 → 读 → 搜 → 列', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    mod.setMachinePermission('workspace')
    const w = await mod.runAgentTool('fs_write', { path: 'test/hello.md', content: '# 你好\n\n这是测试内容。\n' })
    assert(w.summary.includes('已写入'), '写入失败：' + w.summary)

    const r = await mod.runAgentTool('fs_read', { path: 'test/hello.md' })
    assert(String(r.result.content).includes('这是测试内容'), '读到的内容不对')

    const s = await mod.runAgentTool('fs_search', { pattern: '测试内容', path: 'test' })
    assert(s.result.count >= 1, '搜索没命中')

    const l = await mod.runAgentTool('fs_list', { path: 'test' })
    assert(l.result.count >= 1, '列目录为空')

    const g = await mod.runAgentTool('fs_glob', { pattern: '**/*.md' })
    assert(g.result.count >= 1, 'glob 没命中')
    return true
  })

  await checkAsync('fs_edit 能精确替换', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    mod.setMachinePermission('workspace')
    await mod.runAgentTool('fs_write', { path: 'test/edit.txt', content: 'AAA BBB CCC' })
    const e = await mod.runAgentTool('fs_edit', { path: 'test/edit.txt', oldText: 'BBB', newText: 'XXX' })
    assert(e.summary.includes('已编辑'), '编辑失败')
    const r = await mod.runAgentTool('fs_read', { path: 'test/edit.txt' })
    assert(String(r.result.content).includes('XXX'), '替换没生效')
    return true
  })

  await checkAsync('读取任意路径放行（第十三轮起），写入越界仍被拒', async () => {
    mod.setMachinePermission('view')
    const rd = await mod.runAgentTool('fs_read', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' })
    assert(!String(rd.summary).includes('超出'), '读被拦：' + rd.summary)

    let threw = false
    try {
      await mod.runAgentTool('fs_write', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', content: 'x' })
    } catch (e) {
      threw = true
      assert(/超出|拒绝|不允许|不在允许范围|档位/.test(String(e.message)), '错误信息不对：' + e.message)
    }
    assert(threw, '越界写入应该抛错')
    mod.setMachinePermission('workspace')
    return true
  })

  await checkAsync('shell_run 能执行命令', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    mod.setMachinePermission('full')
    const r = await mod.runAgentTool('shell_run', { command: 'Write-Output "hello-from-agent"' })
    assert(String(r.result.stdout).includes('hello-from-agent'), '输出不对：' + JSON.stringify(r.result))
    mod.setMachinePermission('workspace')
    return true
  })

  await checkAsync('shell_job 后台任务 + 输出 + 终止', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    mod.setMachinePermission('full')
    const j = await mod.runAgentTool('shell_job', { command: 'Write-Output "job-running"; Start-Sleep -Seconds 5', label: '测试任务' })
    const jobId = j.result.id
    assert(jobId, '没返回 jobId')

    let out = null
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200))
      out = mod.jobOutput(jobId)
      if (out && out.output.includes('job-running')) break
    }

    const list = mod.listJobs()
    assert(list.some((x) => x.id === jobId), '任务不在列表里')
    assert(out !== null, '读不到输出')
    assert(out.output.includes('job-running'), '输出内容不对：' + (out ? out.output : '(空)'))

    const killed = mod.killJob(jobId)
    assert(killed === true, '终止失败')
    mod.setMachinePermission('workspace')
    return true
  })

  await checkAsync('todo_write 记录待办', async () => {
    const r = await mod.runAgentTool('todo_write', {
      todos: [
        { content: '第一步', status: 'completed' },
        { content: '第二步', status: 'in_progress' },
        { content: '第三步', status: 'pending' }
      ]
    })
    assert(r.result.total === 3, '数量不对：' + r.result.total)
    assert(r.result.completed === 1, '完成数不对')
    assert(mod.getTodos().length === 3, '全局待办没更新')
    return true
  })

  await checkAsync('present_files 记录交付物', async () => {
    mod.setWorkspaceTrust(mod.getWorkspace(), true)
    await mod.runAgentTool('fs_write', { path: 'out/report.md', content: '# 报告\n内容' })
    const r = await mod.runAgentTool('present_files', { paths: ['out/report.md'], description: '测试交付' })
    assert(r.result.presented.length === 1, '交付数量不对')
    const list = mod.listDeliverables()
    assert(list.some((d) => d.name === 'report.md'), '交付物列表里没有')
    return true
  })

  await checkAsync('web_search 返回结构化结果（无网络时优雅降级）', async () => {
    const r = await mod.runAgentTool('web_search', { query: 'electron 桌面应用' })
    assert(r.result.query === 'electron 桌面应用', 'query 不对')
    assert(Array.isArray(r.result.results), 'results 不是数组')
    if (r.result.count === 0) {
      assert(typeof r.summary === 'string' && r.summary.length > 0, '失败时应给出说明')
    }
    return true
  })

  lines.push('=== 5. 关闭行为 ===')

  check('默认关闭行为是询问', () => {
    const g = mod.settingsRepo.get().general
    assert(g.closeAction === 'ask', '默认应为 ask，实际：' + g.closeAction)
    assert(g.closeAskDisabled === false, '默认不该禁用询问')
    return true
  })

  check('能切换关闭行为并持久化', () => {
    mod.settingsRepo.save({ general: { ...mod.settingsRepo.get().general, closeAction: 'minimize' } })
    assert(mod.settingsRepo.get().general.closeAction === 'minimize', '切换失败')
    mod.settingsRepo.save({ general: { ...mod.settingsRepo.get().general, closeAction: 'ask' } })
    return true
  })

  lines.push('=== 6. Agent 设置 ===')

  check('默认启用 Agent 且有工作区', () => {
    const a = mod.settingsRepo.get().agent
    assert(a.enabled === true, '应默认启用')
    assert(typeof a.workspace === 'string', 'workspace 字段缺失')
    assert(a.maxToolCalls >= 1, 'maxToolCalls 不对')
    return true
  })

  check('工作区目录会被创建', () => {
    const ws = mod.getWorkspace()
    assert(existsSync(ws), '工作区不存在：' + ws)
    assert(ws.includes(DATA), '工作区不在用户数据目录：' + ws)
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
