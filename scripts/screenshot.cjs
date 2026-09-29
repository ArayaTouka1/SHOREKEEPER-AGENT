/**
 */
const { spawn, execSync } = require('node:child_process')
const { mkdirSync, rmSync, writeFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const PACKAGED = process.argv.includes('--packaged')
const PORT = 9240
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(ROOT, 'screenshots')

const EXE = PACKAGED
  ? join(ROOT, 'release', 'win-unpacked', '守岸人陪伴终端.exe')
  : join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const EXE_ARGS = PACKAGED ? [] : ['.']
const USER_DATA = join(process.env.APPDATA, '守岸人陪伴终端')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function killAll() {
  for (const n of ['守岸人陪伴终端', 'electron']) {
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
  rmSync(join(USER_DATA, 'data'), { recursive: true, force: true })
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const child = spawn(EXE, [...EXE_ARGS, '--no-sandbox', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore'
  })
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
    console.error('应用未能启动')
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

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const file = join(OUT, name + '.png')
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    console.log('  已截图 ' + name + '.png')
  }

  for (let i = 0; i < 40; i++) {
    const t = await ev(`return document.querySelector('.splash-title')?.textContent || ''`)
    if (t.includes('SHOREKEEPER')) break
    await sleep(250)
  }
  await sleep(600)
  await shot('01-splash')

  await ev(`document.querySelector('.splash-btn')?.click(); return true`)
  await sleep(1500)
  await shot('02-home')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click()
    await new Promise(r=>setTimeout(r,600))
    const ta = document.querySelector('textarea')
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
    set.call(ta, '守岸人，你是怎么诞生的？')
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    await new Promise(r=>setTimeout(r,200))
    ;[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='↑').click()
    return true
  `)
  await sleep(7000)
  await shot('03-chat-born')

  await ev(`
    const ta = document.querySelector('textarea')
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
    set.call(ta, '守岸人 看下我的电脑状态')
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    await new Promise(r=>setTimeout(r,200))
    ;[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='↑').click()
    return true
  `)
  await sleep(7000)
  await shot('04-chat-hardware')

  await ev(`
    const ta = document.querySelector('textarea')
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
    set.call(ta, '打开网易云音乐')
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    await new Promise(r=>setTimeout(r,200))
    ;[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='↑').click()
    return true
  `)
  await sleep(3500)
  await shot('05-coop-approval')

  await ev(`
    const b = [...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='允许一次')
    if (b) b.click()
    return true
  `)
  await sleep(6000)
  await ev(`
    const b = [...document.querySelectorAll('button')].find(x=>x.textContent.includes('查看原始返回'))
    if (b) b.click()
    await new Promise(r=>setTimeout(r,600))
    return true
  `)
  await sleep(600)
  await shot('06-coop-json')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('记忆')).click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(500)
  await shot('07-memory')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('智能体')).click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(500)
  await shot('08-agent')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click()
    await new Promise(r=>setTimeout(r,800))
    return true
  `)
  await sleep(500)
  await shot('09-settings-character')

  await ev(`
    document.querySelector('.set-item[data-label="人格"]').click()
    await new Promise(r=>setTimeout(r,600))
    return true
  `)
  await sleep(500)
  await shot('10-settings-persona')

  await ev(`
    document.querySelector('.set-item[data-label="语音"]').click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(500)
  await shot('11-settings-voice')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('首页')).click()
    await new Promise(r=>setTimeout(r,800))
    return true
  `)
  await sleep(400)
  await ev(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await new Promise(r=>setTimeout(r,700))
    return true
  `)
  await sleep(500)
  await shot('12-command-palette')

  await ev(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r=>setTimeout(r,400))
    ;[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click()
    await new Promise(r=>setTimeout(r,800))
    document.querySelector('.set-item[data-label="主题"]').click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(600)
  await shot('13-settings-theme')

  await ev(`
    const b = document.querySelector('[data-theme-id="midnight"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,1000))
    ;[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(700)
  await shot('14-dark-theme-chat')

  await ev(`
    ;[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click()
    await new Promise(r=>setTimeout(r,800))
    document.querySelector('.set-item[data-label="主题"]').click()
    await new Promise(r=>setTimeout(r,700))
    const b = document.querySelector('[data-theme-id="sakura"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,900))
    document.querySelector('.set-item[data-label="人格"]').click()
    await new Promise(r=>setTimeout(r,800))
    const p = document.querySelector('[data-persona-id="persona_aemeath"]')
    if (p) p.click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(700)
  await shot('15-persona-aemeath')

  await ev(`
    document.querySelector('.set-item[data-label="语音"]').click()
    await new Promise(r=>setTimeout(r,1000))
    return true
  `)
  await sleep(700)
  await shot('16-voice-pack')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('对话')).click()
    await new Promise(r=>setTimeout(r,900))
    const b = document.querySelector('[data-testid="model-selector"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(600)
  await shot('18-model-selector')

  await ev(`
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(r=>setTimeout(r,500))
    const b = document.querySelector('[data-testid="attach-btn"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(600)
  await shot('19-attachment-panel')

  await ev(`
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await new Promise(r=>setTimeout(r,500))
    const b = document.querySelector('[data-testid="win-close"]')
    if (b) b.click()
    await new Promise(r=>setTimeout(r,1100))
    return true
  `)
  await sleep(700)
  await shot('20-close-dialog')

  await ev(`
    const btns = [...document.querySelectorAll('[data-testid="close-dialog"] button')]
    const cancel = btns.find(b=>b.textContent.includes('取消'))
    if (cancel) cancel.click()
    await new Promise(r=>setTimeout(r,600))
    ;[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('智能体')).click()
    await new Promise(r=>setTimeout(r,1100))
    return true
  `)
  await sleep(700)
  await shot('21-agent-tools')

  await ev(`
    [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置')).click()
    await new Promise(r=>setTimeout(r,800))
    document.querySelector('.set-item[data-label="模型"]').click()
    await new Promise(r=>setTimeout(r,1000))
    return true
  `)
  await sleep(600)
  await shot('22-settings-model')

  await ev(`
    document.querySelector('.set-item[data-label="常规"]').click()
    await new Promise(r=>setTimeout(r,900))
    return true
  `)
  await sleep(600)
  await shot('23-settings-general')

  console.log('\n截图目录: ' + OUT)
  ws.close()
  await sleep(400)
  killAll()
})().catch((e) => {
  console.error('截图失败: ' + e.message)
  killAll()
  process.exit(1)
})
