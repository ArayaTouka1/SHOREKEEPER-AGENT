/**
 *
 */

const { spawn, execSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { mkdirSync, existsSync } = require('node:fs')

const ROOT = resolve(__dirname, '..')
const PORT = 9310
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = join(ROOT, 'screenshots')
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
    console.error('启动失败')
    process.exit(1)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pend = new Map()
  const errs = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errs.push(String(m.params?.exceptionDetails?.exception?.description || '').slice(0, 160))
    }
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const my = ++id
      pend.set(my, (m) => res(m.result))
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async()=>{${expr}})()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) return 'EXC:' + String(r.exceptionDetails.exception?.description || '').slice(0, 160)
    return r.result?.value
  }
  const shot = async (name) => {
    if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })
    const r = await send('Page.captureScreenshot', { format: 'png' })
    if (r?.data) {
      require('node:fs').writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'))
      return name
    }
    return null
  }

  await send('Runtime.enable')
  await send('Page.enable')

  for (let i = 0; i < 50; i++) {
    const r = await ev(`return document.querySelectorAll('.rail-item').length`)
    if (r >= 7) break
    await sleep(500)
  }
  await ev(`const b=document.querySelector('.splash-btn'); if(b) b.click(); return true`)
  await sleep(2200)

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

  const goto = async (label) => {
    await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click(); await new Promise(r=>setTimeout(r,1000)); return true`)
    await sleep(800)
    const ok = await ev(`
      const el = [...document.querySelectorAll('.set-item')].find(e => (e.getAttribute('data-label')||e.textContent||'').includes(${JSON.stringify(label)}))
      if (!el) return false
      el.click()
      await new Promise(r=>setTimeout(r,1400))
      return true
    `)
    await sleep(1000)
    return ok
  }

  console.log('\n========== 第八轮 GUI 验证 ==========\n')

  console.log('=== A. 设置页结构 ===')
  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click(); await new Promise(r=>setTimeout(r,1200)); return true`)
  await sleep(1000)

  const sections = await ev(`
    return JSON.stringify([...document.querySelectorAll('.set-item')].map(e => e.getAttribute('data-label') || e.textContent.trim()))
  `)
  const secList = JSON.parse(sections)
  console.log('        分页: ' + secList.join(' / '))
  check('有「表情包」分页', secList.some((s) => s.includes('表情包')), sections)
  check('有「插件」分页', secList.some((s) => s.includes('插件')))
  check('「模型」与「AI 与 API」已整合', secList.some((s) => s.includes('模型与 API')), sections)
  check('不再有独立的「AI 与 API」分页', !secList.includes('AI 与 API'), sections)

  console.log('\n=== B. 表情包 ===')
  await goto('表情包')

  const stickerPanel = await ev(`
    const text = document.body.innerText
    return JSON.stringify({
      hasTitle: text.includes('表情包库'),
      hasUpload: !!document.querySelector('[data-testid="sticker-upload-btn"]'),
      hasWebToggle: !!document.querySelector('[data-testid="sticker-web-toggle"]'),
      charCards: document.querySelectorAll('[data-sticker-char]').length,
      gridImgs: document.querySelectorAll('.sticker-cell img').length
    })
  `)
  const sp = JSON.parse(stickerPanel)
  check('表情包管理页存在', sp.hasTitle === true, stickerPanel)
  check('有「添加表情包」按钮', sp.hasUpload === true)
  check('有「从网络搜集」按钮', sp.hasWebToggle === true)
  check('列出 4 个角色', sp.charCards === 4, '实际 ' + sp.charCards)
  check('表情包网格有图', sp.gridImgs > 20, '实际 ' + sp.gridImgs)
  await shot('34-sticker-panel.png')

  await ev(`
    const cards = [...document.querySelectorAll('[data-sticker-char]')]
    const ae = cards.find(c => c.getAttribute('data-sticker-char') === 'char_aemeath')
    if (ae) ae.click()
    await new Promise(r=>setTimeout(r,1600))
    return true
  `)
  await sleep(1200)
  const aeStickers = await ev(`return document.querySelectorAll('.sticker-cell img').length`)
  check('无专属素材的角色也能看到表情包（共享池）', aeStickers > 20, '实际 ' + aeStickers)

  await ev(`const b=document.querySelector('[data-testid="sticker-web-toggle"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,700)); return true`)
  await sleep(700)
  const webPanel = await ev(`
    const t = document.body.innerText
    const searchInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('搜索关键词'))
    const pageInput = [...document.querySelectorAll('input')].find(i => (i.placeholder||'').includes('网页地址'))
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '扒图')
    return JSON.stringify({
      open: t.includes('收起网络搜集'),
      hasSearch: !!searchInput,
      hasPage: !!pageInput,
      hasBtn: !!btn
    })
  `)
  const wp = JSON.parse(webPanel)
  check('网络搜集面板能展开', wp.open === true, webPanel)
  check('有搜索输入框', wp.hasSearch === true, webPanel)
  check('有网页地址输入框', wp.hasPage === true, webPanel)
  check('有扒图按钮', wp.hasBtn === true, webPanel)
  await shot('41-sticker-web.png')

  console.log('\n=== C. 对话页 ===')
  await ev(`[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click(); await new Promise(r=>setTimeout(r,1400)); return true`)
  await sleep(1400)

  const chatBtns = await ev(`
    return JSON.stringify({
      stickerBtn: !!document.querySelector('[data-testid="sticker-btn"]'),
      sendBtn: !!document.querySelector('[data-testid="chat-send"]'),
      permBadge: !!document.querySelector('[data-testid="permission-badge"]')
    })
  `)
  const cb = JSON.parse(chatBtns)
  check('输入框旁有表情包按钮', cb.stickerBtn === true, chatBtns)
  check('有发送按钮', cb.sendBtn === true)
  check('有权限档位按钮', cb.permBadge === true)
  await shot('35-chat-with-sticker-btn.png')

  await ev(`const b=document.querySelector('[data-testid="sticker-btn"]'); if(b) b.click(); await new Promise(r=>setTimeout(r,900)); return true`)
  await sleep(900)
  const picker = await ev(`
    const p = document.querySelector('[data-testid="sticker-picker"]')
    return JSON.stringify({
      open: !!p,
      tabs: p ? p.querySelectorAll('[data-sticker-tab]').length : 0,
      imgs: p ? p.querySelectorAll('.sticker-cell img').length : 0
    })
  `)
  const pk = JSON.parse(picker)
  check('表情包选择器能打开', pk.open === true, picker)
  check('选择器有 3 个来源标签', pk.tabs === 3, '实际 ' + pk.tabs)
  check('选择器里有表情包', pk.imgs > 10, '实际 ' + pk.imgs)
  await shot('36-sticker-picker.png')

  console.log('\n=== D. 权限档位 ===')
  await ev(`const b=document.querySelector('[data-testid="sticker-btn"]'); if(b && document.querySelector('[data-testid="sticker-picker"]')) { b.click(); await new Promise(r=>setTimeout(r,500)) } return true`)
  await sleep(600)

  await ev(`
    const b = document.querySelector('[data-testid="permission-badge"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,800))
    return true
  `)
  await sleep(800)

  const permPop = await ev(`
    const p = document.querySelector('[data-testid="permission-popover"]')
    return JSON.stringify({
      open: !!p,
      options: p ? p.querySelectorAll('[data-testid^="permission-option-"]').length : 0,
      text: p ? p.innerText.slice(0, 240) : ''
    })
  `)
  const pp = JSON.parse(permPop)
  check('权限浮层能打开', pp.open === true, permPop)
  check('有 3 个档位可选', pp.options === 3, '实际 ' + pp.options)
  check('档位说明含中文', pp.text.includes('仅可查看') || pp.text.includes('工作目录'), pp.text)
  await shot('37-permission-tiers.png')

  const before = await ev(`const r = await window.aimis.agent.machinePermission(); return JSON.stringify(r)`)
  const beforeTier = (() => {
    try {
      return JSON.parse(String(before)).data?.tier ?? ''
    } catch {
      return ''
    }
  })()

  await ev(`
    const b = document.querySelector('[data-testid="permission-option-full"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,1500))
    return true
  `)
  await sleep(1300)
  const permSaved = await ev(`const r = await window.aimis.agent.machinePermission(); return JSON.stringify(r)`)
  check('切到完全权限并落盘', String(permSaved).includes('full'), String(permSaved).slice(0, 200))

  await ev(`
    const badge = document.querySelector('[data-testid="permission-badge"]')
    if (badge) badge.click()
    await new Promise(r=>setTimeout(r,700))
    const o = document.querySelector('[data-testid="permission-option-workspace"]')
    if (o) o.click()
    await new Promise(r=>setTimeout(r,1400))
    return true
  `)
  await sleep(1200)
  const permBack = await ev(`const r = await window.aimis.agent.machinePermission(); return JSON.stringify(r)`)
  check('能切回工作目录档', String(permBack).includes('workspace'), String(permBack).slice(0, 200))
  console.log(`        （初始档位：${beforeTier || '未知'}）`)

  console.log('\n=== E. 自定义称呼 ===')
  await goto('角色')
  const addrBox = await ev(`return !!document.querySelector('[data-testid="user-address"]')`)
  check('有「她怎么称呼你」输入框', addrBox === true)

  const setAddr = await ev(`
    const el = document.querySelector('[data-testid="user-address"]')
    if (!el) return 'NO_INPUT'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '阿漂')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r=>setTimeout(r,400))
    const btn = document.querySelector('[data-testid="user-address-save"]')
    if (btn) btn.click()
    await new Promise(r=>setTimeout(r,1600))
    const r = await window.aimis.character.list()
    const active = r.data.find(c => c.id === r.data.find(x=>x.active)?.id) || r.data[0]
    return JSON.stringify({ saved: r.data.map(c => c.userAddressOverride).filter(Boolean) })
  `)
  check('能保存自定义称呼', String(setAddr).includes('阿漂'), String(setAddr).slice(0, 200))
  await shot('38-user-address.png')

  console.log('\n=== F. 插件 ===')
  await goto('插件')
  const pluginPanel = await ev(`
    const t = document.body.innerText
    return JSON.stringify({
      hasList: t.includes('插件'),
      hasImport: !!document.querySelector('[data-testid="plugin-import"]'),
      hasRefresh: !!document.querySelector('[data-testid="plugin-refresh"]'),
      hasOpenDir: !!document.querySelector('[data-testid="plugin-open-dir"]'),
      builtinShown: t.includes('hello') || t.includes('Hello') || t.includes('示例')
    })
  `)
  const pl = JSON.parse(pluginPanel)
  check('插件面板存在', pl.hasList === true, pluginPanel)
  check('有「导入插件」按钮', pl.hasImport === true)
  check('有刷新按钮', pl.hasRefresh === true)
  check('有打开目录按钮', pl.hasOpenDir === true)
  check('内置示例插件已列出', pl.builtinShown === true, pluginPanel)
  await shot('39-plugin-panel.png')

  console.log('\n=== G. 协作 · 关闭应用 ===')
  await goto('协作')
  const coop = await ev(`
    const t = document.body.innerText
    return JSON.stringify({
      hasPanel: !!document.querySelector('[data-testid="running-app-list"]'),
      hasRefresh: !!document.querySelector('[data-testid="running-app-refresh"]'),
      text: t.slice(t.indexOf('已启动的应用'), t.indexOf('已启动的应用') + 120)
    })
  `)
  const co = JSON.parse(coop)
  check('有「已启动的应用」面板', co.hasPanel === true, coop)
  check('有刷新按钮', co.hasRefresh === true)
  await shot('40-running-apps.png')

  console.log('\n=== H. 稳定性 ===')
  check('全程无未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))

  console.log('\n========================================')
  console.log(`  GUI 验证：通过 ${pass} 项，失败 ${fail} 项`)
  console.log('========================================\n')

  ws.close()
  await sleep(400)
  killAll()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('失败:', e.message)
  killAll()
  process.exit(2)
})
