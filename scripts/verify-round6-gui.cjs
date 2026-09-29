/**
 */

const { spawn, execSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const PORT = 9280
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

;(async () => {
  killAll()
  await sleep(1500)

  const child = spawn(
    join(ROOT, 'node_modules/electron/dist/electron.exe'),
    ['.', '--no-sandbox', `--remote-debugging-port=${PORT}`],
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
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
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
  const shot = async (n) => {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, n + '.png'), Buffer.from(s.data, 'base64'))
    console.log('  已截图 ' + n + '.png')
  }

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
  await sleep(2000)

  console.log('\n=== A. 对话页人格切换器 ===')
  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1000)

  const sw = await ev(`
    const b = document.querySelector('[data-testid="persona-switcher"]')
    return { has: !!b, current: b ? b.dataset.persona : '', text: b ? b.textContent.trim() : '' }
  `)
  check('对话页有人格切换按钮', sw.has === true, JSON.stringify(sw))
  check('按钮显示当前人格', !!sw.current, JSON.stringify(sw))

  await ev(`document.querySelector('[data-testid="persona-switcher"]').click(); await new Promise(r=>setTimeout(r,900)); return true`)
  await sleep(700)
  const pop = await ev(`
    const el = document.querySelector('[data-testid="persona-popover"]')
    return {
      open: !!el,
      options: document.querySelectorAll('[data-persona-option]').length,
      text: el ? el.innerText : ''
    }
  `)
  check('人格面板能打开', pop.open === true)
  check('列出 4 个内置人格', pop.options >= 4, '实际: ' + pop.options)
  check('面板显示音色信息', String(pop.text).includes('音色'), String(pop.text).slice(0, 120))
  check('提示会同步换音色', String(pop.text).includes('同步换音色'), String(pop.text).slice(0, 160))
  await shot('27-persona-switcher')

  const readActive = `
    const b = await window.aimis.bootstrap()
    const c = b.data.character
    return { id: c.id, name: c.name, voice: c.voice.voiceId, pack: c.voice.voicePackFile }
  `
  const before = await ev(readActive)
  console.log('  切换前:', JSON.stringify(before))

  await ev(`
    const btn = document.querySelector('[data-persona-option="persona_aemeath"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 2500))
    return true
  `)
  await sleep(2000)

  const after = await ev(readActive)
  console.log('  切换后:', JSON.stringify(after))
  check('切人格后角色也跟着切', after.id !== before.id, `仍是 ${after.id}`)
  check('切人格后语音包也跟着切', after.pack !== before.pack, `仍是 ${after.pack}`)
  check('切人格后 Inworld 音色也跟着切', after.voice !== before.voice, `仍是 ${after.voice}`)

  const toast = await ev(`
    for (let i = 0; i < 30; i++) {
      const el = document.querySelector('[data-testid="persona-toast"]')
      if (el && el.innerText.trim()) return el.innerText
      await new Promise(r => setTimeout(r, 100))
    }
    return ''
  `)
  check('切人格有反馈提示', String(toast).length > 0, '没有 toast')

  await ev(`
    document.querySelector('[data-testid="persona-switcher"]').click()
    await new Promise(r => setTimeout(r, 800))
    const btn = document.querySelector('[data-persona-option="persona_shorekeeper"]')
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 2500))
    return true
  `)
  await sleep(1800)
  const back = await ev(`const b = await window.aimis.bootstrap(); return b.data.character.id`)
  check('能切回守岸人', back === 'char_shorekeeper', back)

  console.log('\n=== B. 模型切换反馈 ===')
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); await new Promise(r=>setTimeout(r,500)); return true`)
  await sleep(500)
  await ev(`document.querySelector('[data-testid="model-selector"]').click(); await new Promise(r=>setTimeout(r,900)); return true`)
  await sleep(700)
  const mpop = await ev(`
    const el = document.querySelector('[data-testid="model-popover"]')
    return { open: !!el, items: document.querySelectorAll('[data-model-id]').length, text: el?el.innerText:'' }
  `)
  check('模型选择器能打开', mpop.open === true)
  check('有可切换的模型', mpop.items >= 5, '实际: ' + mpop.items)

  await ev(`const b=document.querySelector('[data-model-id="api_moonshot"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1000)
  const mtoast = await ev(`
    for (let i = 0; i < 30; i++) {
      const el = document.querySelector('[data-testid="model-toast"]')
      if (el && el.innerText.trim()) return el.innerText
      await new Promise(r => setTimeout(r, 100))
    }
    return ''
  `)
  check('模型切换有反馈提示', String(mtoast).includes('已切换到'), String(mtoast))
  const mlabel = await ev(`return document.querySelector('[data-testid="model-selector"]').textContent.trim()`)
  check('模型标签已更新', String(mlabel).includes('Kimi'), String(mlabel))

  await ev(`document.querySelector('[data-testid="model-selector"]').click(); await new Promise(r=>setTimeout(r,800)); const b=document.querySelector('[data-model-id="api_deepseek"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1000)

  console.log('\n=== C. 本地模型连接/断开 ===')
  await ev(`document.querySelector('[data-testid="model-selector"]').click(); await new Promise(r=>setTimeout(r,900)); return true`)
  await sleep(700)
  const localToggle = await ev(`return !!document.querySelector('[data-testid="local-toggle"]')`)
  check('有本地模型折叠区', localToggle === true)

  await ev(`const b=document.querySelector('[data-testid="local-toggle"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,800)); return true`)
  await sleep(700)
  const connectBtn = await ev(`return !!document.querySelector('[data-testid="local-connect-local_ollama"]')`)
  check('未连接的本地模型有「连接」按钮', connectBtn === true)
  await shot('28-local-models')

  const connectResult = await ev(`
    const b = document.querySelector('[data-testid="local-connect-local_ollama"]')
    if (b) b.click()
    await new Promise(r => setTimeout(r, 4000))
    for (let i = 0; i < 60; i++) {
      const t = document.querySelector('[data-testid="model-toast"]')
      if (t && t.innerText.trim()) return { toast: t.innerText, hasToast: true }
      await new Promise(r => setTimeout(r, 100))
    }
    return { toast: '', hasToast: false }
  `)
  check('点「连接」有反馈', connectResult.hasToast === true, JSON.stringify(connectResult))

  await ev(`await window.aimis.model.markConnected({ id: 'local_ollama', ok: true }); return true`)
  await sleep(400)
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); return true`)
  await sleep(400)
  await ev(`document.querySelector('[data-testid="model-selector"]').click(); await new Promise(r=>setTimeout(r,1400)); return true`)
  await sleep(1100)

  const connected = await ev(`
    const el = document.querySelector('[data-testid="model-popover"]')
    return {
      text: el ? el.innerText : '',
      hasDisconnect: !!document.querySelector('[data-testid="chat-disconnect-local_ollama"]'),
      hasModelItem: !!document.querySelector('[data-model-id="local_ollama"]')
    }
  `)
  check('打开选择器会刷新已连接的本地模型', String(connected.text).includes('本地部署（已连接）'), String(connected.text).slice(0, 160))
  check('连接后可选中', connected.hasModelItem === true, JSON.stringify(connected).slice(0, 200))
  check('连接后有「断开」按钮', connected.hasDisconnect === true, JSON.stringify(connected).slice(0, 200))
  await shot('29-connected-local')

  await ev(`
    const b = document.querySelector('[data-testid="chat-disconnect-local_ollama"]')
    if (b) b.click()
    await new Promise(r => setTimeout(r, 2000))
    return true
  `)
  await sleep(1600)

  const afterDisc = await ev(`
    const t = document.querySelector('[data-testid="model-toast"]')
    const list = await window.aimis.model.list()
    const m = (list.data||[]).find(x => x.id === 'local_ollama')
    const st = await window.aimis.model.state()
    return {
      toast: t ? t.innerText : '',
      available: m ? m.available : null,
      inState: !!(st.data && st.data.localConnections && st.data.localConnections['local_ollama']),
      hasDisconnect: !!document.querySelector('[data-testid="chat-disconnect-local_ollama"]')
    }
  `)
  check('断开有反馈提示', String(afterDisc.toast).includes('已断开'), String(afterDisc.toast))
  check('断开后不再可用', afterDisc.available === false, 'available=' + afterDisc.available)
  check('断开状态已持久化', afterDisc.inState === false, JSON.stringify(afterDisc))
  check('断开后断开按钮消失', afterDisc.hasDisconnect === false)

  console.log('\n=== D. 设置页断开入口 ===')
  await ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click(); await new Promise(r=>setTimeout(r,1000)); document.querySelector('.set-item[data-label="模型"]').click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1000)

  await ev(`await window.aimis.model.disconnectAll(); return true`)
  await sleep(400)
  await ev(`document.querySelector('.set-item[data-label="主题"]').click(); await new Promise(r=>setTimeout(r,600)); document.querySelector('.set-item[data-label="模型"]').click(); await new Promise(r=>setTimeout(r,1400)); return true`)
  await sleep(1000)

  const mset = await ev(`
    const text = document.body.innerText
    return {
      hasClearKey: !!document.querySelector('[data-testid="clear-api-key"]'),
      hasSaveKey: !!document.querySelector('[data-testid="save-api-key"]'),
      keyStatus: /未填写|已填写/.test(text),
      hasConnect: !!document.querySelector('[data-testid="connect-local_ollama"]'),
      hasDisconnect: !!document.querySelector('[data-testid="disconnect-local_ollama"]'),
      bodyHasOllama: text.includes('Ollama')
    }
  `)
  check('有「保存密钥」按钮', mset.hasSaveKey === true)
  check('显示密钥填写状态', mset.keyStatus === true)
  check('未连接的本地模型显示「连接」', mset.hasConnect === true)
  check('未连接时不显示「断开」', mset.hasDisconnect === false)
  await shot('30-settings-model-disconnect')

  await ev(`await window.aimis.model.markConnected({ id: 'local_ollama', ok: true }); return true`)
  await sleep(400)
  await ev(`document.querySelector('.set-item[data-label="主题"]').click(); await new Promise(r=>setTimeout(r,500)); document.querySelector('.set-item[data-label="模型"]').click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(900)
  const mset2 = await ev(`
    return {
      hasDisconnect: !!document.querySelector('[data-testid="disconnect-local_ollama"]'),
      hasDisconnectAll: !!document.querySelector('[data-testid="disconnect-all"]')
    }
  `)
  check('已连接时显示「断开连接」', mset2.hasDisconnect === true)
  check('有「全部断开」按钮', mset2.hasDisconnectAll === true)

  await ev(`
    const input = document.querySelector('[data-testid="api-key"]')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'sk-test-123')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 300))
    }
    const save = document.querySelector('[data-testid="save-api-key"]')
    if (save) save.click()
    await new Promise(r => setTimeout(r, 1200))
    return true
  `)
  await sleep(1200)
  const clearBtn = await ev(`return !!document.querySelector('[data-testid="clear-api-key"]')`)
  check('填了密钥后出现「清空密钥」', clearBtn === true)

  await ev(`const b=document.querySelector('[data-testid="clear-api-key"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,1500)); return true`)
  await sleep(1300)
  const cleared = await ev(`
    const r = await window.aimis.settings.get()
    return { key: r.data.llm.apiKey, hasClear: !!document.querySelector('[data-testid="clear-api-key"]') }
  `)
  check('清空后密钥真的为空', cleared.key === '', 'key=' + JSON.stringify(cleared.key))
  check('清空后按钮消失', cleared.hasClear === false)

  await ev(`await window.aimis.model.disconnectAll(); return true`)

  console.log('\n========================================')
  console.log(`  GUI 验证：通过 ${pass} 项，失败 ${fail} 项`)
  console.log('========================================\n')

  ws.close()
  await sleep(400)
  killAll()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('验证失败:', e.message)
  killAll()
  process.exit(2)
})
