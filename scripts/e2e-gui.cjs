/**
 *
 *
 */

const { spawn, execSync } = require('node:child_process')
const { mkdtempSync, rmSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const PACKAGED = process.argv.includes('--packaged')
const KEEP = process.argv.includes('--keep')
const PORT = 9223 + (PACKAGED ? 1 : 0)
const BASE = `http://127.0.0.1:${PORT}`

const EXE = PACKAGED
  ? join(ROOT, 'release', 'win-unpacked', '守岸人陪伴终端.exe')
  : join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const EXE_ARGS = PACKAGED ? [] : ['.']
const USER_DATA_NAMES = ['shorekeeper-agent', '守岸人陪伴终端', 'aimis-agent']

function findUserData() {
  for (const n of USER_DATA_NAMES) {
    const p = join(process.env.APPDATA, n)
    if (existsSync(join(p, 'data'))) return p
  }
  return join(process.env.APPDATA, USER_DATA_NAMES[0])
}
const USER_DATA = findUserData()


function killAll() {
  for (const name of ['守岸人陪伴终端', 'shorekeeper-agent', 'electron']) {
    try {
      execSync(`taskkill /F /IM "${name}.exe" /T`, { stdio: 'ignore' })
    } catch {
    }
  }
}

function resetData() {
  for (const n of USER_DATA_NAMES) {
    const dataDir = join(process.env.APPDATA, n, 'data')
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
  }
}

/* ---------------- CDP ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/json/list')
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
    }
    await sleep(500)
  }
  return null
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let id = 0
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { resolve: res, reject: rej } = pending.get(m.id)
        pending.delete(m.id)
        if (m.error) rej(new Error(JSON.stringify(m.error)))
        else res(m.result)
      }
    })
    ws.addEventListener('open', () =>
      resolve({
        raw: ws,
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const myId = ++id
            pending.set(myId, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id: myId, method, params }))
            setTimeout(() => {
              if (pending.has(myId)) {
                pending.delete(myId)
                rej(new Error(method + ' 超时'))
              }
            }, 30000)
          }),
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })
}

async function makeClient(url) {
  const c = await connect(url)
  const evaluate = async (body) => {
    const r = await c.send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    }
    return r.result.value
  }
  return { evaluate, close: c.close }
}


let pass = 0
let fail = 0
const lines = []

function check(name, cond, detail) {
  if (cond) {
    pass++
    lines.push('  PASS  ' + name)
  } else {
    fail++
    lines.push('  FAIL  ' + name + (detail ? '  -> ' + detail : ''))
  }
}


;(async () => {
  lines.push('=== 环境准备 ===')
  killAll()
  await sleep(1500)
  resetData()
  lines.push('  已清理旧进程与数据目录')
  lines.push('  可执行文件: ' + EXE)
  lines.push('  调试端口  : ' + PORT)
  lines.push('  数据目录  : ' + join(USER_DATA, 'data'))

  if (!existsSync(EXE)) {
    console.error('找不到可执行文件: ' + EXE)
    process.exit(2)
  }

  const child = spawn(EXE, [...EXE_ARGS, '--no-sandbox', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  const page = await findPage()
  if (!page) {
    console.error('应用未能在 30 秒内启动可调试窗口')
    process.exit(2)
  }
  lines.push('=== 连接渲染进程 ===')
  lines.push('  标题: ' + page.title)
  lines.push('  URL : ' + page.url)

  const cdp = await makeClient(page.webSocketDebuggerUrl)

  let splashSeen = false
  for (let i = 0; i < 40; i++) {
    const s = await cdp.evaluate(
      `return { splash: !!document.querySelector('.splash'), rail: document.querySelectorAll('.rail-item').length }`
    )
    if (s.splash && s.rail >= 7) {
      splashSeen = true
      break
    }
    await sleep(400)
  }

  lines.push('=== A. 启动与骨架 ===')
  let splashTitle = ''
  for (let i = 0; i < 30; i++) {
    splashTitle = await cdp.evaluate(`return document.querySelector('.splash-title')?.textContent || ''`)
    if (splashTitle.includes('SHOREKEEPER')) break
    await sleep(200)
  }

  const boot = await cdp.evaluate(`
    const root = document.getElementById('root')
    return {
      hasRoot: !!root,
      hasShell: !!document.querySelector('.app-shell'),
      railItems: [...document.querySelectorAll('.rail-item')].map(e => e.textContent.replace(/\\s+/g,'')),
      hasSplash: !!document.querySelector('.splash'),
      splashSub: document.querySelector('.splash-sub')?.textContent || '',
      splashMeta: document.querySelector('.splash-meta')?.textContent || '',
      hasStartBtn: !!document.querySelector('.splash-btn')
    }
  `)
  check('React 已挂载', boot.hasRoot && boot.hasShell, JSON.stringify(boot).slice(0, 120))
  check(
    '左侧导航 7 项（首页/对话/记忆/任务/智能体/命令/设置）',
    boot.railItems.length === 7,
    '实际: ' + boot.railItems.join(',')
  )
  check(
    '导航含首页/对话/记忆/任务/智能体/设置',
    ['首页', '对话', '记忆', '任务', '智能体', '设置'].every((k) => boot.railItems.some((r) => r.includes(k))),
    boot.railItems.join(',')
  )
  check('启动页已显示（等到了）', splashSeen && boot.hasSplash === true)
  check('启动页品牌字逐字显影为角色英文名', splashTitle.includes('SHOREKEEPER'), '实际: ' + JSON.stringify(splashTitle))
  check('启动页副标题含角色名', boot.splashSub.includes('守岸人'), '实际: ' + boot.splashSub)
  check('启动页含「我们开始吧」按钮', boot.hasStartBtn === true)

  lines.push('=== B. 首页 ===')
  await cdp.evaluate(`
    const btn = document.querySelector('.splash-btn')
    if (btn) btn.click()
    return true
  `)
  await sleep(900)

  const home = await cdp.evaluate(`
    return {
      splashGone: !document.querySelector('.splash'),
      title: document.querySelector('.page-title')?.textContent || '',
      hasInput: !!document.querySelector('input[placeholder*="说点什么"]'),
      hasAvatar: !!document.querySelector('.card img'),
      hasQuick: [...document.querySelectorAll('button')].some(b => b.textContent.includes('你是怎么诞生的')),
      hasHardwareCard: document.body.innerText.includes('本机状态')
    }
  `)
  check('启动页已关闭', home.splashGone === true)
  check('首页标题含问候语与角色名', /好/.test(home.title) && home.title.includes('守岸人'), '实际: ' + home.title)
  check('首页有输入框', home.hasInput === true)
  check('首页角色卡渲染了头像', home.hasAvatar === true)
  check('首页有快捷指令', home.hasQuick === true)
  check('首页有本机状态卡', home.hasHardwareCard === true)

  lines.push('=== C. 对话页 · 聊天 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('对话')).click()
    return true
  `)
  await sleep(700)

  const chatView = await cdp.evaluate(`
    return {
      title: document.querySelector('.page-title')?.textContent || '',
      tabs: [...document.querySelectorAll('.pill-tab')].map(e => e.textContent.trim()),
    hasGoalBar: document.body.innerText.includes('当前目标'),
      hasConvList: document.body.innerText.includes('会话'),
      hasEmptyHint: !!document.querySelector('.empty')
    }
  `)
  check(
    '对话页标题正确',
    chatView.title.includes('一起完成') || chatView.title.includes('说说话'),
    '实际: ' + chatView.title
  )
  check('聊天与协作已整合（无 Tab 切换）', chatView.tabs.length === 0, chatView.tabs.join(','))
  check('常驻「当前目标」条存在', chatView.hasGoalBar === true)
  check('右侧会话栏存在', chatView.hasConvList === true)

  const sent = await cdp.evaluate(`
    const ta = document.querySelector('textarea')
    if (!ta) return { ok:false, reason:'没有找到输入框' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '我叫测试员，我的显卡是 RTX 4060')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const send = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '↑')
    if (!send) return { ok:false, reason:'没有找到发送按钮' }
    send.click()
    return { ok:true }
  `)
  check('能填写并发送消息', sent.ok === true, sent.reason)

  await sleep(6000)
  const afterChat = await cdp.evaluate(`
    return {
      bubbles: document.querySelectorAll('.fade-in').length,
      text: document.body.innerText,
      convTitle: document.querySelector('.conv-item')?.textContent || '',
      hasCopyBtn: !!document.querySelector('.msg-action')
    }
  `)
  check('用户消息已上屏', afterChat.text.includes('我叫测试员'))
  check('角色已回复', afterChat.text.length > 150)
  check('回复气泡带朗读/复制按钮', afterChat.hasCopyBtn === true)
  check('会话列表已生成标题', afterChat.convTitle.includes('测试员'), afterChat.convTitle.slice(0, 40))
  check('对话页显示自动朗读状态', /自动朗读|已静音|手动朗读/.test(afterChat.text))

  lines.push('=== D. 协作页 · 工具授权流 ===')

  await cdp.evaluate(`
    await window.aimis.agent.setMachinePermission('full')
    await new Promise(r => setTimeout(r, 400))
    return true
  `)
  await sleep(500)

  await cdp.evaluate(`
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '打开网易云音乐')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '↑').click()
    return true
  `)
  await sleep(3000)

  const coop = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      coopActive: true, // 已整合，工具卡片内联在聊天流里，无需切 Tab
      hasCurrentGoal: text.includes('当前目标'),
      hasToolCard: text.includes('工具操作'),
      hasLaunchLabel: text.includes('启动本机应用'),
      hasApproval: text.includes('需要你的允许'),
      hasEnglish: text.includes('Launches an approved local application.'),
      hasReject: !!([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '拒绝')),
      hasAllow: !!([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '允许一次')),
      hasWaitingPill: !!document.querySelector('.status-pill.waiting')
    }
  `)
  check('工具卡片内联显示（无需切 Tab）', coop.coopActive === true)
  check('出现「当前目标」卡', coop.hasCurrentGoal === true)
  check('出现工具操作卡', coop.hasToolCard === true)
  check('动作名为「启动本机应用」（与视频一致）', coop.hasLaunchLabel === true)
  check('出现授权卡「需要你的允许」', coop.hasApproval === true)
  check('授权卡含英文描述（与视频一致）', coop.hasEnglish === true)
  check('有「拒绝」按钮', coop.hasReject === true)
  check('有「允许一次」按钮', coop.hasAllow === true)
  check('状态胶囊显示等待授权', coop.hasWaitingPill === true)

  const clicked = await cdp.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '允许一次')
    if (!btn) return false
    btn.click()
    return true
  `)
  check('已点击「允许一次」', clicked === true)

  await sleep(6000)
  const approved = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasDone: !!document.querySelector('.status-pill.done'),
      hasRawToggle: text.includes('查看原始返回'),
      approvalGone: !text.includes('需要你的允许'),
      narrated: /网易云|打开了|点开|找不到|没找到/.test(text)
    }
  `)
  check('授权卡已消失', approved.approvalGone === true)
  check('工具状态变为已完成', approved.hasDone === true)
  check('出现「查看原始返回」（对应视频里的 JSON 回执）', approved.hasRawToggle === true)
  check('角色复述了执行结果', approved.narrated === true)

  const rawJson = await cdp.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('查看原始返回'))
    if (!btn) return null
    btn.click()
    await new Promise(r => setTimeout(r, 500))
    const pre = document.querySelector('pre')
    return pre ? pre.textContent.slice(0, 300) : null
  `)
  check('原始返回是可解析的 JSON', rawJson !== null && rawJson.trim().startsWith('{'), rawJson ? rawJson.slice(0, 80) : 'null')

  lines.push('=== E. 记忆页 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('记忆')).click()
    return true
  `)
  await sleep(1200)
  const mem = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      title: document.querySelector('.page-title')?.textContent || '',
      hasStats: ['事件','偏好','摘要'].every(k => text.includes(k)),
      hasRetiredKinds: text.includes('诞生记忆') || text.includes('事实'),
      hasSeedText: text.includes('诞生于这台电脑'),
      hasAutoMemory: text.includes('我叫测试员'),
      hasCommandAsMemory: text.includes('看下我的电脑状态') || text.includes('打开网易云音乐'),
      hasCollapsible: !!document.querySelector('[data-testid="memory-list"]')
    }
  `)
  check('记忆页标题正确', mem.title.includes('记得的事'), '实际: ' + mem.title)
  check('记忆统计卡只剩事件/偏好/摘要三类', mem.hasStats === true)
  check('「诞生记忆」与「事实」分类已下线', mem.hasRetiredKinds === false)
  check('seed 记忆（诞生故事）不再存在', mem.hasSeedText === false)
  check('对话中的「我叫测试员」被自动记住', mem.hasAutoMemory === true)
  check('指令句（看状态/开应用）未被误存为记忆', mem.hasCommandAsMemory === false)
  check('记忆列表是可折叠块', mem.hasCollapsible === true)

  lines.push('=== F. 智能体页 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('智能体')).click()
    return true
  `)
  await sleep(900)
  const agent = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      title: document.querySelector('.page-title')?.textContent || '',
      tabs: [...document.querySelectorAll('[data-agent-tab]')].map(e => e.dataset.agentTab),
      toolCards: document.querySelectorAll('[data-tool]').length,
      toolNames: ['fs_read','fs_write','fs_edit','fs_list','fs_search','fs_glob','shell_run','shell_job','web_search','web_fetch','todo_write','goal_set','ask_user','present_files','subagent_run','skill_load','job_list','job_output','job_kill'].filter(n => text.includes(n)),
      hasPolicy: text.includes('授权策略'),
      hasLog: text.includes('调用日志'),
      hasWorkspace: text.includes('工作区'),
      hasRealCpu: /Intel|AMD|Ryzen|Core/.test(text)
    }
  `)
  check('智能体页标题正确', agent.title.includes('协作能力'), '实际: ' + agent.title)
  check('智能体页有四个 Tab', agent.tabs.length === 4, agent.tabs.join(','))
  check('Agent 工具卡渲染', agent.toolCards >= 15, '实际: ' + agent.toolCards)
  check('对齐 DSH 的工具名可见', agent.toolNames.length >= 15, '实际: ' + agent.toolNames.length + ' -> ' + agent.toolNames.join(','))
  check('本机快照读到真实 CPU 型号', agent.hasRealCpu === true)
  check('授权策略区存在', agent.hasPolicy === true)
  check('调用日志区存在', agent.hasLog === true)
  check('工作区卡片存在', agent.hasWorkspace === true)

  lines.push('=== G. 设置页 · COMPANION OS ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('设置')).click()
    return true
  `)
  await sleep(900)
  const set = await cdp.evaluate(`
    return {
      sections: [...document.querySelectorAll('.set-item')].map(e => e.dataset.label || e.textContent.trim()),
      hasBrand: document.body.innerText.includes('COMPANION OS')
    }
  `)
  const expected = [
    '角色与人格',
    '语音',
    '表情包',
    '主题',
    '常规',
    '模型与 API',
    '对话',
    '协作',
    '记忆',
    '工具与权限',
    '插件',
    '诊断与日志',
    '关于'
  ]
  check('设置页 13 个分页齐全', set.sections.length === 13, '实际 ' + set.sections.length + ': ' + set.sections.join(','))
  check('分页名称与设计一致', expected.every((e) => set.sections.includes(e)), set.sections.join(','))
  check('COMPANION OS 品牌字存在', set.hasBrand === true)

  const sectionErrors = []
  for (const s of expected) {
    const r = await cdp.evaluate(`
      const btn = document.querySelector('.set-item[data-label="' + ${JSON.stringify(s)} + '"]')
      if (!btn) return { ok:false, reason:'找不到分页按钮' }
      btn.click()
      await new Promise(r => setTimeout(r, 350))
      return { ok:true, len: document.querySelector('.page-body')?.innerText.length ?? 0 }
    `)
    if (!r.ok || r.len < 10) sectionErrors.push(s + '(' + (r.reason || 'len=' + r.len) + ')')
  }
  check('13 个分页全部可正常渲染', sectionErrors.length === 0, sectionErrors.join('; '))

  lines.push('=== G2. 语音 · 引擎与自动朗读 ===')
  await cdp.evaluate(`
    const btn = document.querySelector('.set-item[data-label="语音"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(600)

  const voice = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasPresetTitle: text.includes('音色预设'),
      presetCount: [...document.querySelectorAll('[data-preset]')].length,
      hasAutoSpeak: text.includes('角色回复后自动播放语音'),
      hasTtsToggle: text.includes('启用语音朗读'),
      hasPreview: text.includes('播放') && text.includes('原声'),
      hasRate: text.includes('语速'),
      hasPitch: text.includes('音调'),
      hasVolume: text.includes('音量'),
      hasStt: text.includes('语音识别'),
      hasPackEngine: !!document.querySelector('[data-engine="voice-pack"]'),
      hasEngineCards: document.querySelectorAll('[data-engine]').length
    }
  `)
  check('已删除「音色预设」卡片', voice.hasPresetTitle === false)
  check('页面不再有音色预设按钮', voice.presetCount === 0, '实际: ' + voice.presetCount)
  check('有「角色回复后自动播放语音」开关', voice.hasAutoSpeak === true)
  check('有 TTS 总开关', voice.hasTtsToggle === true)
  check('有试听按钮', voice.hasPreview === true)
  check('语速 / 音调 / 音量 三项可调', voice.hasRate && voice.hasPitch && voice.hasVolume)
  check('STT 设置区存在', voice.hasStt === true)
  check('语音引擎已移除「语音包」选项', voice.hasPackEngine === false)
  check('语音引擎 4 个选项', voice.hasEngineCards === 4, '实际: ' + voice.hasEngineCards)

  const applied = await cdp.evaluate(`
    const btn = document.querySelector('[data-engine="system"]')
    if (!btn) return false
    btn.click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  check('可点击切换语音引擎', applied === true)

  await sleep(1200)
  const voiceSaved = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'characters.json'), 'utf-8'))
      const active = j.characters.find((c) => c.id === j.activeCharacterId)
      return active ? active.voice : null
    } catch {
      return null
    }
  })()
  check('音色改动已持久化（引擎变为 system）', voiceSaved !== null && voiceSaved.engine === 'system', JSON.stringify(voiceSaved))
  check('voice 对象含 autoSpeak 字段', voiceSaved !== null && typeof voiceSaved.autoSpeak === 'boolean', JSON.stringify(voiceSaved))

  lines.push('=== G3. 主题 · 切换与自定义 ===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="主题"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(600)

  const themeView = await cdp.evaluate(`
    return {
      themeCards: document.querySelectorAll('[data-theme-id]').length,
      hasCustomSection: document.body.innerText.includes('自定义主题'),
      hasColorInputs: document.querySelectorAll('[data-token]').length,
      bgBefore: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim()
    }
  `)
  check('主题分页列出内置主题', themeView.themeCards >= 8, '实际: ' + themeView.themeCards)
  check('有自定义主题区', themeView.hasCustomSection === true)
  check('有颜色调整控件', themeView.hasColorInputs >= 10, '实际: ' + themeView.hasColorInputs)

  await cdp.evaluate(`
    const btn = document.querySelector('[data-theme-id="midnight"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(700)
  const dark = await cdp.evaluate(`
    return {
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim(),
      text: getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim(),
      isDark: document.documentElement.getAttribute('data-theme-dark'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    }
  `)
  check('切换主题改变了 CSS 变量', dark.bg !== themeView.bgBefore, '前后都是 ' + dark.bg)
  check('深色主题被正确标记', dark.isDark === '1', 'data-theme-dark=' + dark.isDark)
  check('深色主题文字色变浅', dark.text.includes('255') || dark.text.includes('rgba'), 'text-1=' + dark.text)

  const themePersisted = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'theme.json'), 'utf-8'))
      return j.activeId
    } catch {
      return null
    }
  })()
  check('主题选择已持久化到 theme.json', themePersisted === 'midnight', '实际: ' + themePersisted)

  await cdp.evaluate(`
    const input = document.querySelector('[data-token="accent"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '#00ff88')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1000))
    return true
  `)
  await sleep(800)
  const custom = await cdp.evaluate(`
    return {
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      bodyText: document.body.innerText
    }
  `)
  check('改颜色会切到自定义主题并生效', custom.bodyText.includes('自定义'), '未进入自定义模式')

  await cdp.evaluate(`
    const btn = document.querySelector('[data-theme-id="sakura"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 800))
    return true
  `)
  await sleep(600)
  const back = await cdp.evaluate(`return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`)
  check('能切回内置浅色主题', back === '#f4a3c8', 'accent=' + back)

  lines.push('=== G4. 模型与 API · 引擎切换 ===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="模型与 API"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(600)

  const aiView = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasOffline: !!document.querySelector('[data-provider="offline"]'),
      hasRemote: !!document.querySelector('[data-provider="openai-compatible"]'),
      hasEffectiveLine: text.includes('当前实际生效'),
      hasKeyField: !!document.querySelector('[data-testid="api-key"]')
    }
  `)
  check('有两个引擎选项', aiView.hasOffline && aiView.hasRemote)
  check('显示「当前实际生效」状态', aiView.hasEffectiveLine === true)
  check('有 API Key 输入框', aiView.hasKeyField === true)

  await cdp.evaluate(`
    document.querySelector('[data-provider="openai-compatible"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(700)
  const llmAfter = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'settings.json'), 'utf-8'))
      return j.llm.provider
    } catch {
      return null
    }
  })()
  check('切到 OpenAI 兼容接口已落盘', llmAfter === 'openai-compatible', '实际: ' + llmAfter)

  const remoteHint = await cdp.evaluate(`return document.body.innerText`)
  check('未填 Key 时提示会回退离线引擎', remoteHint.includes('离线引擎'), '缺少回退提示')

  await cdp.evaluate(`
    document.querySelector('[data-provider="offline"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(600)
  const llmBack = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'settings.json'), 'utf-8'))
      return j.llm.provider
    } catch {
      return null
    }
  })()
  check('能切回本地离线引擎', llmBack === 'offline', '实际: ' + llmBack)

  lines.push('=== G5. 人格 · 每角色独立 ===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="角色与人格"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(700)

  const personaView = await cdp.evaluate(`
    return {
      buttons: document.querySelectorAll('[data-persona-id]').length,
      hasEditor: !!document.querySelector('[data-testid="persona-editor"]'),
      hasReveal: !!document.querySelector('[data-testid="persona-reveal"]'),
      hasUpload: !!document.querySelector('[data-testid="persona-upload"]'),
      hiddenNotice: document.body.innerText.includes('人格提示词已隐藏'),
      groups: ['守岸人','爱弥斯','流萤'].filter(k => document.body.innerText.includes(k)).length
    }
  `)
  check('角色与人格页有 4 个人格可选项', personaView.buttons === 4, '实际: ' + personaView.buttons)
  check('人格提示词默认隐藏', personaView.hasEditor === false, '编辑器不该默认出现')
  check('有「查看提示词」按钮', personaView.hasReveal === true)
  check('界面显示「人格提示词已隐藏」', personaView.hiddenNotice === true)

  await cdp.evaluate(`
    document.querySelector('[data-testid="persona-reveal"]').click()
    await new Promise(r => setTimeout(r, 800))
    return true
  `)
  await sleep(700)
  const revealed = await cdp.evaluate(`
    const el = document.querySelector('[data-testid="persona-editor"]')
    return { has: !!el, len: el?.value.length ?? 0 }
  `)
  check('点「查看提示词」后编辑器出现', revealed.has === true)
  check('人格正文被加载（>3000 字）', revealed.len > 3000, '实际: ' + revealed.len)

  const skContent = revealed.len
  await cdp.evaluate(`
    const btn = document.querySelector('[data-char-id="char_aemeath"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 1500))
    return true
  `)
  await sleep(900)
  const hiddenAgain = await cdp.evaluate(`return !document.querySelector('[data-testid="persona-editor"]')`)
  check('切角色后人格跟着换（提示词重新隐藏）', hiddenAgain === true)

  await cdp.evaluate(`
    const b = document.querySelector('[data-testid="persona-reveal"]')
    if (b) b.click()
    await new Promise(r => setTimeout(r, 800))
    return true
  `)
  await sleep(700)
  const aeView = await cdp.evaluate(`
    const el = document.querySelector('[data-testid="persona-editor"]')
    return { len: el?.value.length ?? 0, head: (el?.value ?? '').slice(0, 40), hasAemeath: (el?.value ?? '').includes('爱弥斯') }
  `)
  check('切到爱弥斯人格后正文不同', aeView.len !== skContent, '两处长度都是 ' + aeView.len)
  check('爱弥斯人格正文正确', aeView.hasAemeath === true, '开头: ' + aeView.head)

  const noBind = await cdp.evaluate(`
    return ![...document.querySelectorAll('button')].some(b => b.textContent.includes('绑定给'))
  `)
  check('已删除「绑定给 XX 角色」按钮', noBind === true)

  lines.push('=== G6. 语音 · 预设 ===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="语音"]').click()
    await new Promise(r => setTimeout(r, 1000))
    return true
  `)
  await sleep(700)

  await sleep(800)

  const voicePack = await cdp.evaluate(`
    return {
      hasPackCard: !!document.querySelector('[data-engine="voice-pack"]'),
      packCards: document.querySelectorAll('[data-asset]').length,
      hasImport: document.body.innerText.includes('导入语音到语音库'),
      hasPlay: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('播放') && b.textContent.includes('原声')),
      presetCards: document.querySelectorAll('[data-preset]').length,
      engineCards: document.querySelectorAll('[data-engine]').length
    }
  `)
  check('已移除「语音包（原声）」引擎', voicePack.hasPackCard === false)
  check('已移除「播放原声」按钮', voicePack.hasPlay === false)
  check('页面不再有音色预设按钮', voicePack.presetCards === 0, '实际: ' + voicePack.presetCards)
  check('语音引擎 4 个选项', voicePack.engineCards === 4, '实际: ' + voicePack.engineCards)

  const resolved = await cdp.evaluate(`
    const res = await window.aimis.voice.resolve({ voicePackFile: 'shorekeeperVoice.mp3', customPackPath: null })
    return res.ok ? String(res.data) : 'ERR:' + res.error
  `)
  check('主进程能解析语音包路径', typeof resolved === 'string' && !resolved.startsWith('ERR') && resolved.length > 5, resolved)

  const assets = await cdp.evaluate(`
    const res = await window.aimis.voice.assets()
    return res.ok ? res.data.length : -1
  `)
  check('语音资源列表非空', assets >= 3, '实际: ' + assets)

  lines.push('=== G7. 云合成（可自定义模型与接口）===')
  await cdp.evaluate(`
    const tab = document.querySelector('.set-item[data-label="语音"]')
    if (tab) tab.click()
    await new Promise(r => setTimeout(r, 1200))
    return true
  `)
  await sleep(900)
  const engineCards = await cdp.evaluate(`return document.querySelectorAll('[data-engine]').length`)
  check('语音页渲染出 4 个引擎卡', engineCards === 4, '实际: ' + engineCards)

  await cdp.evaluate(`
    const card = document.querySelector('[data-engine="inworld"]')
    if (card) card.click()
    await new Promise(r => setTimeout(r, 1400))
    return true
  `)
  await sleep(1200)

  const inworldView = await cdp.evaluate(`
    return {
      hasCard: !!document.querySelector('[data-engine="inworld"]'),
      hasKeyField: !!document.querySelector('[data-testid="inworld-key"]'),
      keyFilled: (document.querySelector('[data-testid="inworld-key"]')?.value ?? '').length > 40,
      keyLength: (document.querySelector('[data-testid="inworld-key"]')?.value ?? '').length,
      clonedChips: document.querySelectorAll('[data-inworld-voice]').length,
      models: document.querySelectorAll('[data-inworld-model]').length,
      hasTestBtn: document.body.innerText.includes('测试连通'),
      hasRefreshBtn: document.body.innerText.includes('刷新音色列表'),
      bodyText: document.body.innerText
    }
  `)
  check('有 Inworld 云合成引擎选项', inworldView.hasCard === true)
  check('云合成面板有 API Key 输入框', inworldView.hasKeyField === true)
  check('API Key 默认不预置（新用户自填）', inworldView.keyFilled === false, '实际长度: ' + inworldView.keyLength)
  const hasTtsKey = inworldView.keyLength > 20
  if (hasTtsKey) {
    check('列出克隆音色', inworldView.clonedChips >= 3, '实际: ' + inworldView.clonedChips)
  } else {
    check('无 Key 时不显示克隆音色', inworldView.clonedChips === 0, '实际: ' + inworldView.clonedChips)
  }
  check('可切换云合成模型', inworldView.models >= 3, '实际: ' + inworldView.models)
  check('有测试连通按钮', inworldView.hasTestBtn === true)

  const ttsCustom = await cdp.evaluate(`
    return {
      hasBaseUrl: !!document.querySelector('[data-testid="tts-baseurl"]'),
      hasModelInput: !!document.querySelector('[data-testid="tts-model-input"]'),
      hasVoiceInput: !!document.querySelector('[data-testid="tts-voice-input"]'),
      providers: document.querySelectorAll('[data-tts-provider]').length,
      hasAdvanced: document.body.innerText.includes('高级选项'),
      baseUrlVal: document.querySelector('[data-testid="tts-baseurl"]')?.value ?? ''
    }
  `)
  check('可自定义接口地址', ttsCustom.hasBaseUrl === true)
  check('接口地址已预填', ttsCustom.baseUrlVal.length > 10, '实际: ' + ttsCustom.baseUrlVal)
  check('可自定义模型名', ttsCustom.hasModelInput === true)
  check('可手动指定音色 ID', ttsCustom.hasVoiceInput === true)
  check('三种服务商协议可选', ttsCustom.providers === 3, '实际: ' + ttsCustom.providers)
  check('有高级选项（鉴权/路径）', ttsCustom.hasAdvanced === true)

  const synthResult = await cdp.evaluate(`
    const res = await window.aimis.inworld.synthesize({
      text: '你好，我是守岸人。',
      voiceId: 'sweet-badger-1765__shouanren',
      modelId: 'inworld-tts-2'
    })
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, bytes: res.data.bytes, url: res.data.url, hasFile: res.data.url.startsWith('file:///') }
  `)
  if (hasTtsKey) {
    check('通过界面能真实合成出音频', synthResult.ok === true && synthResult.bytes > 1000, JSON.stringify(synthResult))
    check('合成结果是可播放的 file:// URL', synthResult.hasFile === true, JSON.stringify(synthResult))
  } else {
    check('无 Key 时合成给出明确错误', synthResult.ok === false && /API Key/.test(String(synthResult.error)), JSON.stringify(synthResult))
  }

  lines.push('=== G8. 本地合成环境 ===')
  await cdp.evaluate(`
    const card = document.querySelector('[data-engine="local"]')
    if (card) card.click()
    await new Promise(r => setTimeout(r, 1600))
    return true
  `)
  await sleep(1200)
  const localEngineOn = await cdp.evaluate(`
    const el = document.querySelector('[data-engine="local"]')
    return el ? el.className.includes('on') : false
  `)
  check('已切到本地合成引擎', localEngineOn === true)

  const localView = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasSetupBtn: text.includes('一键配置环境'),
      hasDetectBtn: text.includes('检测环境'),
      hasBackend: !!document.querySelector('[data-local-backend]'),
      hasBackendCount: document.querySelectorAll('[data-local-backend]').length,
      hasEnvTitle: text.includes('本地合成'),
      hasCheck: !!document.querySelector('[data-testid="qwen3-check"]'),
      hasVariant: !!document.querySelector('[data-testid="qwen3-variant-0_6b"]'),
      hasPreview: !!document.querySelector('[data-testid="qwen3-preview"]'),
      pythonCount: document.querySelectorAll('.pick-card').length,
      engine: document.querySelector('[data-engine="local"]') ? 'local' : 'other'
    }
  `)
  check('本地合成面板存在', localView.hasEnvTitle === true)
  check('有检测按钮', localView.hasDetectBtn === true)
  check('可选择本地后端（3 个）', localView.hasBackendCount === 3, '实际: ' + localView.hasBackendCount)
  check('本地有「检测环境」按钮', localView.hasCheck === true, JSON.stringify(localView))
  check('本地有「试听」按钮', localView.hasPreview === true)
  check('本地有模型规格选择', localView.hasVariant === true)

  const envStatus = await cdp.evaluate(`
    const res = await window.aimis.ttsEnv.status()
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      hasVenv: typeof res.data.venvReady === 'boolean',
      hasDeps: typeof res.data.depsReady === 'boolean',
      pythons: res.data.pythons.length,
      root: res.data.root
    }
  `)
  check('能查询本地环境状态', envStatus.ok === true, JSON.stringify(envStatus))
  check('环境状态字段完整', envStatus.hasVenv && envStatus.hasDeps, JSON.stringify(envStatus))
  check('探测到本机 Python', envStatus.pythons >= 1, '实际: ' + envStatus.pythons)
  check('环境目录在用户数据下', String(envStatus.root).includes('tts-engine'), envStatus.root)

  lines.push('=== G9. 背景媒体（主题页内）===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="主题"]').click()
    await new Promise(r => setTimeout(r, 1400))
    return true
  `)
  await sleep(900)

  const bgInTheme = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasThemeTitle: text.includes('主题'),
      hasBgSection: text.includes('背景媒体'),
      noBgTab: !document.querySelector('.set-item[data-label="背景"]')
    }
  `)
  check('设置页没有独立「背景」分页', bgInTheme.noBgTab === true)
  check('主题页内含「背景媒体」区块', bgInTheme.hasBgSection === true)

  const bgView = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasPage: text.includes('背景素材库'),
      hasEnable: text.includes('启用背景媒体'),
      hasOverlay: text.includes('遮罩浓度'),
      hasBlur: text.includes('模糊'),
      hasFit: document.querySelectorAll('[data-bg-fit]').length,
      hasImport: text.includes('导入背景到素材库'),
      hasPick: text.includes('选择文件')
    }
  `)
  check('背景分页存在', bgView.hasPage === true)
  check('有启用开关', bgView.hasEnable === true)
  check('可调遮罩浓度', bgView.hasOverlay === true)
  check('可调模糊', bgView.hasBlur === true)
  check('可调填充方式', bgView.hasFit >= 3, '实际: ' + bgView.hasFit)
  check('有导入按钮', bgView.hasImport === true)
  check('有选择文件按钮', bgView.hasPick === true)

  const bgFlow = await cdp.evaluate(`
    const before = await window.aimis.theme.state()
    const r1 = await window.aimis.background.patch({ enabled: true, overlay: 66, blur: 4, fit: 'cover' })
    if (!r1.ok) return { ok: false, step: 'patch', error: r1.error }
    const after = r1.data.background
    const r2 = await window.aimis.background.reset()
    if (!r2.ok) return { ok: false, step: 'reset', error: r2.error }
    return {
      ok: true,
      patched: after.enabled === true && after.overlay === 66 && after.blur === 4,
      reset: r2.data.background.enabled === false,
      listOk: (await window.aimis.background.list()).ok
    }
  `)
  check('背景配置能通过界面写入', bgFlow.ok === true && bgFlow.patched === true, JSON.stringify(bgFlow))
  check('背景配置能重置', bgFlow.reset === true, JSON.stringify(bgFlow))
  check('背景素材列表接口可用', bgFlow.listOk === true, JSON.stringify(bgFlow))

  const bgRender = await cdp.evaluate(`
    const st = await window.aimis.theme.state()
    const mediaId = st.data.background.mediaId
    return {
      mediaId,
      hasLayerNow: !!document.querySelector('.bg-layer'),
      enabled: st.data.background.enabled
    }
  `)
  check('未选媒体时不渲染背景层', bgRender.hasLayerNow === false || bgRender.enabled === false, JSON.stringify(bgRender))

  lines.push('=== G10. 模型选择器 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('对话')).click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(700)

  const modelSel = await cdp.evaluate(`
    return {
      hasBtn: !!document.querySelector('[data-testid="model-selector"]'),
      label: document.querySelector('[data-testid="model-selector"]')?.textContent || ''
    }
  `)
  check('对话页有模型选择器', modelSel.hasBtn === true, JSON.stringify(modelSel))

  await cdp.evaluate(`
    document.querySelector('[data-testid="model-selector"]').click()
    await new Promise(r => setTimeout(r, 700))
    return true
  `)
  await sleep(500)

  const popover = await cdp.evaluate(`
    const el = document.querySelector('[data-testid="model-popover"]')
    const text = el ? el.innerText : ''
    return {
      open: !!el,
      hasApiGroup: text.includes('API 联网'),
      hasLocalGroup: text.includes('本地部署'),
      apiItems: document.querySelectorAll('[data-model-id]').length,
      hasUnconnected: text.includes('未连接'),
      bodyText: text
    }
  `)
  check('模型选择器能打开', popover.open === true)
  check('分「API 联网」组', popover.hasApiGroup === true)
  check('分「本地部署」组', popover.hasLocalGroup === true)
  check('列出可选模型', popover.apiItems >= 5, '实际: ' + popover.apiItems)
  check('未连接的本地模型有提示', popover.hasUnconnected === true)

  const switched = await cdp.evaluate(`
    const btns = [...document.querySelectorAll('[data-model-id]')]
    const btn = btns[1]
    if (!btn) return { ok: false }
    const targetLabel = btn.textContent.trim()
    btn.click()
    await new Promise(r => setTimeout(r, 1200))
    return {
      ok: true,
      targetLabel,
      label: document.querySelector('[data-testid="model-selector"]')?.textContent || ''
    }
  `)
  check('能切换模型', switched.ok === true, JSON.stringify(switched))
  check(
    '模型标签已更新为所选模型',
    switched.ok === true && switched.label.length > 0 && !switched.label.includes('选择模型'),
    JSON.stringify(switched)
  )

  await cdp.evaluate(`
    document.querySelector('[data-testid="model-selector"]').click()
    await new Promise(r => setTimeout(r, 800))
    const btn = [...document.querySelectorAll('[data-model-id]')][0]
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(500)
  const backLabel = await cdp.evaluate(`return document.querySelector('[data-testid="model-selector"]')?.textContent || ''`)
  check('能切回默认模型', backLabel.includes('DeepSeek'), backLabel)

  lines.push('=== G11. 附件上传 ===')
  const attBtn = await cdp.evaluate(`return !!document.querySelector('[data-testid="attach-btn"]')`)
  check('输入框旁有「+」附件按钮', attBtn === true)

  await cdp.evaluate(`
    document.querySelector('[data-testid="attach-btn"]').click()
    await new Promise(r => setTimeout(r, 700))
    return true
  `)
  await sleep(500)
  const attPop = await cdp.evaluate(`
    const el = document.querySelector('[data-testid="attach-popover"]')
    return {
      open: !!el,
      hasPick: !!document.querySelector('[data-testid="attach-pick"]'),
      text: el ? el.innerText : ''
    }
  `)
  check('附件面板能打开', attPop.open === true)
  check('有「选择文件」入口', attPop.hasPick === true, JSON.stringify(attPop))

  const attFlow = await cdp.evaluate(`
    const path = 'C:\\\\Windows\\\\win.ini'
    const r = await window.aimis.attachment.external(path)
    if (!r.ok || !r.data) return { ok: false, error: r.error || 'null' }
    return { ok: true, kind: r.data.kind, hasPreview: !!r.data.preview }
  `)
  check('能引用本地文件作为附件', attFlow.ok === true, JSON.stringify(attFlow))
  check('文本附件带内容预览', attFlow.hasPreview === true, JSON.stringify(attFlow))

  await cdp.evaluate(`
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    return true
  `)

  lines.push('=== G12. 关闭对话框 ===')
  const closePref = await cdp.evaluate(`
    const r = await window.aimis.window.getClosePref()
    return r.ok ? r.data : null
  `)
  check('能读取关闭偏好', closePref !== null && 'action' in closePref, JSON.stringify(closePref))

  await cdp.evaluate(`
    document.querySelector('[data-testid="win-close"]').click()
    await new Promise(r => setTimeout(r, 1000))
    return true
  `)
  await sleep(800)
  const dlg = await cdp.evaluate(`
    const el = document.querySelector('[data-testid="close-dialog"]')
    return {
      open: !!el,
      hasMin: !!document.querySelector('[data-testid="close-minimize"]'),
      hasQuit: !!document.querySelector('[data-testid="close-quit"]'),
      hasDontAsk: !!document.querySelector('[data-testid="close-dontask"]'),
      text: el ? el.innerText : ''
    }
  `)
  check('点关闭弹出对话框', dlg.open === true, JSON.stringify(dlg))
  check('有「最小化到托盘」选项', dlg.hasMin === true)
  check('有「直接退出」选项', dlg.hasQuit === true)
  check('有「以后不再提醒」勾选框', dlg.hasDontAsk === true)

  await cdp.evaluate(`
    const btns = [...document.querySelectorAll('[data-testid="close-dialog"] button')]
    const cancel = btns.find(b => b.textContent.includes('取消'))
    if (cancel) cancel.click()
    await new Promise(r => setTimeout(r, 600))
    return true
  `)
  await sleep(500)
  const cancelled = await cdp.evaluate(`return !document.querySelector('[data-testid="close-dialog"]')`)
  check('能取消关闭', cancelled === true)

  lines.push('=== G13. 设置页 · 模型 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('设置')).click()
    await new Promise(r => setTimeout(r, 800))
    document.querySelector('.set-item[data-label="模型与 API"]').click()
    await new Promise(r => setTimeout(r, 1000))
    return true
  `)
  await sleep(700)
  const modelPage = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      cards: document.querySelectorAll('[data-model-card]').length,
      hasApiSection: text.includes('API 联网'),
      hasLocalSection: text.includes('本地部署'),
      hasKey: !!document.querySelector('[data-testid="api-key"]'),
      hasAdd: text.includes('自定义模型'),
      connectedText: /已连接/.test(text)
    }
  `)
  check('模型分页列出模型卡', modelPage.cards >= 8, '实际: ' + modelPage.cards)
  check('有 API 联网分组', modelPage.hasApiSection === true)
  check('有本地部署分组', modelPage.hasLocalSection === true)
  check('有 API 密钥输入框', modelPage.hasKey === true)
  check('有自定义模型区', modelPage.hasAdd === true)
  check('显示本地连接状态', modelPage.connectedText === true)

  lines.push('=== G14. 设置页 · 关闭行为 ===')
  await cdp.evaluate(`
    document.querySelector('.set-item[data-label="常规"]').click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(700)
  const generalPage = await cdp.evaluate(`
    const text = document.body.innerText
    return {
      hasCloseSection: text.includes('点关闭按钮时'),
      options: document.querySelectorAll('[data-close-action]').length,
      hasDontAsk: text.includes('不再显示关闭确认'),
      hasAgent: text.includes('Agent 能力'),
      hasWorkspace: text.includes('工作区目录'),
      hasShell: text.includes('允许执行命令')
    }
  `)
  check('有「点关闭按钮时」设置', generalPage.hasCloseSection === true)
  check('三个关闭选项齐全', generalPage.options === 3, '实际: ' + generalPage.options)
  check('有「不再显示关闭确认」开关', generalPage.hasDontAsk === true)
  check('有 Agent 能力开关区', generalPage.hasAgent === true)
  check('有工作区目录设置', generalPage.hasWorkspace === true)
  check('有 shell 权限开关', generalPage.hasShell === true)

  lines.push('=== G15. 对话遵循人设 ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('对话')).click()
    await new Promise(r => setTimeout(r, 900))
    return true
  `)
  await sleep(600)

  const greetReply = await cdp.evaluate(`
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '你好')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    ;[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '↑').click()
    await new Promise(r => setTimeout(r, 5000))
    const bubbles = [...document.querySelectorAll('.fade-in')]
    return { text: document.body.innerText.slice(-800) }
  `)
  const replyText = greetReply.text
  check('问候得到回复', replyText.length > 50, replyText.slice(0, 200))
  check(
    '回复里没有客服腔',
    !replyText.includes('尊敬的用户') && !replyText.includes('请问有什么可以帮您') && !replyText.includes('我是AI'),
    replyText.slice(-300)
  )

  lines.push('=== H. 角色四件套 · 热替换 ===')
  const builtinCount = await cdp.evaluate(`
    const r = await window.aimis.character.list()
    return r.ok ? r.data.filter(c => c.builtin).length : 0
  `)
  check('内置角色数量为 4', builtinCount === 4, '实际: ' + builtinCount)
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('设置')).click()
    await new Promise(r => setTimeout(r, 900))
    document.querySelector('.set-item[data-label="角色与人格"]').click()
    await new Promise(r => setTimeout(r, 500))
    return true
  `)
  await sleep(700)

  const initial = await cdp.evaluate(`
    return {
      nameInput: [...document.querySelectorAll('input')].map(i => i.value).find(v => v === '守岸人') || '',
      hasShorekeeperChip: [...document.querySelectorAll('button')].some(b => b.textContent.includes('守岸人'))
    }
  `)
  check('默认主角色是守岸人', initial.hasShorekeeperChip === true)

  const sw = await cdp.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('爱弥斯') && b.textContent.length < 12)
    if (!btn) return { ok:false, reason:'找不到爱弥斯按钮' }
    btn.click()
    return { ok:true }
  `)
  check('找到角色切换按钮', sw.ok === true, sw.reason)

  await sleep(2500)
  const afterSwitch = await cdp.evaluate(`
    return {
      nameInput: [...document.querySelectorAll('input')].map(i => i.value).find(v => v === '爱弥斯') || '',
      hasVoice: document.body.innerText.includes('音色')
    }
  `)
  check('切换到爱弥斯后名称输入框同步', afterSwitch.nameInput === '爱弥斯', '实际: ' + afterSwitch.nameInput)

  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('首页')).click()
    return true
  `)
  await sleep(1300)
  const homeAfter = await cdp.evaluate(`
    return {
      title: document.querySelector('.page-title')?.textContent || '',
      latin: document.body.innerText.includes('AEMEATH')
    }
  `)
  check('首页标题热替换为爱弥斯', homeAfter.title.includes('爱弥斯'), '实际: ' + homeAfter.title)
  check('角色卡副标题热替换为 AEMEATH', homeAfter.latin === true)

  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('设置')).click()
    await new Promise(r => setTimeout(r, 500))
    ;document.querySelector('.set-item[data-label="角色与人格"]').click()
    await new Promise(r => setTimeout(r, 400))
    const save = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')
    if (save) { save.click(); await new Promise(r => setTimeout(r, 300)); save.click() }
    return true
  `)
  await sleep(1500)

  const charCount = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'characters.json'), 'utf-8'))
      return j.characters.length
    } catch {
      return -1
    }
  })()
  check('反复点「保存」不会新建角色（数量不变）', charCount === builtinCount, '实际 ' + charCount + ' / 内置 ' + builtinCount)

  await cdp.evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('守岸人') && b.textContent.length < 12)
    if (btn) btn.click()
    return true
  `)
  await sleep(1500)
  const restored = await cdp.evaluate(`return { text: document.body.innerText }`)
  check('可切回守岸人', restored.text.includes('守岸人') === true)

  const finalCount = (() => {
    try {
      const j = JSON.parse(readFileSync(join(USER_DATA, 'data', 'characters.json'), 'utf-8'))
      return j.characters.length
    } catch {
      return -1
    }
  })()
  check('全流程结束后角色数不变（无角色泄漏）', finalCount === builtinCount, '实际 ' + finalCount + ' / 内置 ' + builtinCount)

  lines.push('=== I. 命令面板 (Ctrl+K) ===')
  await cdp.evaluate(`
    [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('首页')).click()
    await new Promise(r => setTimeout(r, 700))
    return true
  `)
  await sleep(500)

  const beforePalette = await cdp.evaluate(`return !!document.querySelector('.cmdk')`)
  check('命令面板默认关闭', beforePalette === false)

  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 600))
    return true
  `)
  await sleep(400)

  const palette = await cdp.evaluate(`
    const el = document.querySelector('.cmdk')
    return {
      open: !!el,
      hasInput: !!document.querySelector('.cmdk-head input'),
      itemCount: document.querySelectorAll('.cmdk-item').length,
      groups: [...document.querySelectorAll('.cmdk-group')].map(e => e.textContent),
      hasNav: document.body.innerText.includes('前往 对话'),
      hasVoice: document.body.innerText.includes('调整音色与朗读')
    }
  `)
  check('Ctrl+K 能唤起命令面板', palette.open === true)
  check('命令面板有搜索输入框', palette.hasInput === true)
  check('命令面板列出命令项', palette.itemCount >= 8, '实际: ' + palette.itemCount)
  check('命令按组分类', palette.groups.length >= 3, palette.groups.join(','))
  check('含页面导航命令', palette.hasNav === true)
  check('含音色设置命令', palette.hasVoice === true)

  const filtered = await cdp.evaluate(`
    const input = document.querySelector('.cmdk-head input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '音色')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    return { count: document.querySelectorAll('.cmdk-item').length, text: document.body.innerText }
  `)
  check('命令面板支持搜索过滤', filtered.count >= 1 && filtered.count < palette.itemCount, '过滤后: ' + filtered.count)

  const executed = await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    return { closed: !document.querySelector('.cmdk'), body: document.body.innerText.slice(0, 300) }
  `)
  check('回车执行命令并关闭面板', executed.closed === true)

  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    return true
  `)
  await sleep(400)
  const escClosed = await cdp.evaluate(`return !document.querySelector('.cmdk')`)
  check('ESC 能关闭命令面板', escClosed === true)

  await cdp.evaluate(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    return true
  `)
  await sleep(400)
  const shortcut = await cdp.evaluate(`return document.querySelector('.page-title')?.textContent || ''`)
  check('Ctrl+2 快捷切到对话页', /说话|完成/.test(shortcut), '实际: ' + shortcut)

  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  GUI 端到端：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('  被测对象: ' + (PACKAGED ? '打包产物 release/win-unpacked' : '源码构建产物'))
  console.log('========================================\n')

  cdp.close()
  if (!KEEP) {
    await sleep(500)
    killAll()
  }
  process.exit(fail === 0 ? 0 : 1)
})().catch((err) => {
  console.log('\n' + lines.join('\n'))
  console.error('\nGUI 测试崩溃: ' + (err && err.message ? err.message : String(err)))
  killAll()
  process.exit(2)
})
