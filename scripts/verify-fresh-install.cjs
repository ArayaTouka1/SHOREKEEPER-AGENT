/**
 *
 */

const { spawn, execSync } = require('node:child_process')
const { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const PORT = 9290
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(ROOT, 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function killAll() {
  for (const n of ['守岸人陪伴终端', 'shorekeeper-agent', 'electron']) {
    try {
      execSync(`taskkill /F /IM "${n}.exe" /T`, { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  }
}

const FRESH = join(process.env.TEMP || '/tmp', 'sk-fresh-' + Date.now())

;(async () => {
  killAll()
  await sleep(1500)

  rmSync(FRESH, { recursive: true, force: true })
  mkdirSync(FRESH, { recursive: true })
  console.log('全新 userData:', FRESH)

  const child = spawn(
    join(ROOT, 'node_modules/electron/dist/electron.exe'),
    ['.', '--no-sandbox', `--user-data-dir=${FRESH}`, `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, detached: true, stdio: 'ignore' }
  )
  child.unref()

  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(BASE + '/json/list')).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) break
    } catch {
      /* wait */
    }
    await sleep(500)
  }
  if (!page) {
    console.error('应用未启动')
    process.exit(1)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pend = new Map()
  const consoleErrors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(String(m.params?.exceptionDetails?.exception?.description || '').slice(0, 200))
    }
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const my = ++id
      pend.set(my, (m) => res(m.result))
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  const ev = async (expr) =>
    (await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }))
      .result?.value

  await send('Runtime.enable')

  let pass = 0
  let fail = 0
  const check = (name, cond, detail) => {
    if (cond) {
      pass++
      console.log('  PASS  ' + name)
    } else {
      fail++
      console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''))
    }
  }

  for (let i = 0; i < 50; i++) {
    const r = await ev(`return document.querySelectorAll('.rail-item').length`)
    if (r >= 7) break
    await sleep(500)
  }
  await ev(`const b=document.querySelector('.splash-btn'); if(b) b.click(); return true`)
  await sleep(2200)

  console.log('\n=== 全新安装状态 ===')

  const state = await ev(`
    const s = await window.aimis.settings.get()
    const b = await window.aimis.bootstrap()
    const t = await window.aimis.agent.todos()
    return {
      llmKey: s.data.llm.apiKey,
      inworldKey: s.data.inworld.apiKey,
      cloudKey: s.data.cloudTts.apiKey,
      conversations: b.data.conversations.length,
      characters: b.data.characters.filter(c => c.builtin).length,
      personas: b.data.personas.filter(p => p.builtin).length,
      memories: b.data.memories.length,
      seedMemories: b.data.memories.filter(m => m.kind === 'seed').length,
      todos: (t.data || []).length,
      activeModel: b.data.activeModelId,
      hasBg: !!document.querySelector('.app-shell')
    }
  `)

  check('LLM API Key 为空', state.llmKey === '', 'key=' + JSON.stringify(state.llmKey))
  check('Inworld API Key 为空', state.inworldKey === '', 'key=' + JSON.stringify(state.inworldKey))
  check('云合成 API Key 为空', state.cloudKey === '', 'key=' + JSON.stringify(state.cloudKey))
  check('对话数 ≤ 1（greet 可能预建一个）', state.conversations <= 1, '实际: ' + state.conversations)
  check('界面正常渲染', state.hasBg === true)
  check('4 个内置角色就绪', state.characters === 4, '实际: ' + state.characters)
  check('4 份内置人格就绪', state.personas === 4, '实际: ' + state.personas)
  check('默认选中 API 模型', String(state.activeModel).startsWith('api_'), state.activeModel)
  check('记忆数为 0（不再预置诞生记忆）', state.memories === 0, '实际: ' + state.memories)
  check('没有 seed 类型的记忆', state.seedMemories === 0, '实际: ' + state.seedMemories)
  check('待办数为 0（不再预置任务）', state.todos === 0, '实际: ' + state.todos)

  console.log('\n=== 新用户引导 ===')

  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click(); await new Promise(r=>setTimeout(r,1000)); (document.querySelector('.set-item[data-label="模型与 API"]') || document.querySelector('.set-item[data-label="模型"]')).click(); await new Promise(r=>setTimeout(r,1200)); const net=document.querySelector('[data-provider="openai-compatible"]'); if(net) net.click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1200)
  const guide = await ev(`
    const text = document.body.innerText
    return {
      hasNotFilled: text.includes('未填写'),
      placeholder: (document.querySelector('[data-testid="api-key"]')||{}).placeholder || '',
      hasSave: !!document.querySelector('[data-testid="save-api-key"]')
    }
  `)
  check('显示「未填写」状态', guide.hasNotFilled === true)
  check('输入框提示新用户自填', String(guide.placeholder).includes('自行填写'), guide.placeholder)
  check('有「保存密钥」按钮', guide.hasSave === true)

  const shot1 = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, '31-fresh-install-model.png'), Buffer.from(shot1.data, 'base64'))
  console.log('  已截图 31-fresh-install-model.png')

  await ev(`document.querySelector('.set-item[data-label="语音"]').click(); await new Promise(r=>setTimeout(r,1300)); const c=document.querySelector('[data-engine="inworld"]'); if(c) c.click(); await new Promise(r=>setTimeout(r,1500)); return true`)
  await sleep(1200)
  const ttsState = await ev(`
    const text = document.body.innerText
    return {
      notVerified: text.includes('未验证'),
      emptyKey: ((document.querySelector('[data-testid="inworld-key"]')||{}).value || '') === '',
      hasTest: !!document.querySelector('[data-testid="tts-test"]')
    }
  `)
  check('云合成显示「未验证」', ttsState.notVerified === true)
  check('云合成 Key 输入框为空', ttsState.emptyKey === true)
  check('有「测试连通」按钮', ttsState.hasTest === true)

  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, '32-fresh-install-tts.png'), Buffer.from(shot2.data, 'base64'))
  console.log('  已截图 32-fresh-install-tts.png')

  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click(); await new Promise(r=>setTimeout(r,1300)); return true`)
  await sleep(1100)
  const chatState = await ev(`
    const text = document.body.innerText
    return {
      hasSwitcher: !!document.querySelector('[data-testid="persona-switcher"]'),
      hasModel: !!document.querySelector('[data-testid="model-selector"]'),
      conversationCount: document.querySelectorAll('.conversation-item, [data-conv-id]').length,
      bodyLen: text.length
    }
  `)
  check('对话页有人格切换器', chatState.hasSwitcher === true)
  check('对话页有模型选择器', chatState.hasModel === true)
  check('对话列表为空', chatState.conversationCount === 0, '实际: ' + chatState.conversationCount)

  const shot3 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, '33-fresh-install-chat.png'), Buffer.from(shot3.data, 'base64'))
  console.log('  已截图 33-fresh-install-chat.png')

  console.log('\n=== 记忆页 / 任务页空状态 ===')

  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('记忆')).click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(900)
  const memPage = await ev(`
    const text = document.body.innerText
    return {
      hasSeed: text.includes('诞生记忆'),
      hasFact: text.includes('事实'),
      hasEmpty: !!document.querySelector('[data-testid="memory-empty"]'),
      hasList: !!document.querySelector('[data-testid="memory-list"]'),
      hasOverview: !!document.querySelector('[data-testid="memory-overview"]'),
      hasCompose: !!document.querySelector('[data-testid="memory-compose"]')
    }
  `)
  check('记忆页不再有「诞生记忆」分类', memPage.hasSeed === false)
  check('记忆页不再有「事实」分类', memPage.hasFact === false)
  check('记忆页渲染空状态', memPage.hasEmpty === true)
  check('记忆页有记忆列表折叠块', memPage.hasList === true)
  check('记忆页有概览/写入折叠块', memPage.hasOverview === true && memPage.hasCompose === true)

  const shot4 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, '34-fresh-install-memory.png'), Buffer.from(shot4.data, 'base64'))
  console.log('  已截图 34-fresh-install-memory.png')

  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('任务')).click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(900)
  const taskPage = await ev(`
    const text = document.body.innerText
    return {
      hasEmpty: !!document.querySelector('[data-testid="task-empty"]'),
      hasTodos: !!document.querySelector('[data-testid="task-todos"]'),
      hasTodosEmpty: !!document.querySelector('[data-testid="task-todos-empty"]'),
      hasList: !!document.querySelector('[data-testid="task-list"]'),
      saysEmpty: text.includes('还没有任何任务记录')
    }
  `)
  check('任务页渲染空状态', taskPage.hasEmpty === true && taskPage.saysEmpty === true)
  check('任务页待办清单为空', taskPage.hasTodosEmpty === true)
  check('任务页有列表/待办折叠块', taskPage.hasList === true && taskPage.hasTodos === true)

  const shot5 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, '35-fresh-install-task.png'), Buffer.from(shot5.data, 'base64'))
  console.log('  已截图 35-fresh-install-task.png')

  check('渲染过程无未捕获异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  console.log('\n========================================')
  console.log(`  新装体验：通过 ${pass} 项，失败 ${fail} 项`)
  console.log('========================================\n')

  ws.close()
  await sleep(400)
  killAll()
  try {
    rmSync(FRESH, { recursive: true, force: true })
  } catch {
  }
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('验证失败:', e.message)
  killAll()
  try {
    rmSync(FRESH, { recursive: true, force: true })
  } catch {
  }
  process.exit(2)
})
