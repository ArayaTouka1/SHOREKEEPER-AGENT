/**
 *
 */
const { spawn, execSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const WEB = path.resolve(ROOT, '..', 'web')
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.exe': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8'
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  const full = path.join(WEB, urlPath.replace(/^\/+/, ''))
  if (!full.startsWith(WEB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
  fs.createReadStream(full).pipe(res)
})

function killAll() {
  for (const n of ['electron']) {
    try { execSync(`taskkill /F /IM "${n}.exe" /T`, { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

;(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  console.log('静态服务: http://127.0.0.1:' + PORT)

  killAll()
  await sleep(800)

  const userData = path.join(process.env.TEMP || '/tmp', 'sk-site-' + Date.now())
  const pageUrl = `http://127.0.0.1:${PORT}/index.html`

  const mainJs = path.join(process.env.TEMP || '/tmp', 'sk-site-main-' + Date.now() + '.cjs')
  fs.writeFileSync(
    mainJs,
    `const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { offscreen: false } })
  w.loadURL(${JSON.stringify(pageUrl)})
  setTimeout(() => app.quit(), 25000)
})
app.on('window-all-closed', () => app.quit())
`,
    'utf8'
  )

  const child = spawn(
    path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    [mainJs, '--no-sandbox', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT + 1}`],
    { cwd: ROOT, detached: true, stdio: 'ignore' }
  )
  child.unref()

  const BASE = `http://127.0.0.1:${PORT + 1}`
  let page = null
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(BASE + '/json/list')).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) break
    } catch { /* wait */ }
    await sleep(500)
  }
  if (!page) {
    console.error('FAIL: 渲染窗口未启动')
    server.close()
    killAll()
    process.exit(1)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const consoleErrors = []
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    const onMsg = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
      }
      if (msg.id === mid) { ws.removeEventListener('message', onMsg); res(msg.result) }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable')

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed')
    return r.result.value
  }

  await sleep(6000)

  let pass = 0
  let fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  OK   ' + name) }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')) }
  }

  const report = await ev(`(() => {
    const q = (s) => document.querySelector(s)
    const all = (s) => Array.from(document.querySelectorAll(s))
    const h = (el) => el ? Math.round(el.getBoundingClientRect().height) : 0
    const imgs = all('img')
    return {
      title: document.title,
      bodyH: document.body.scrollHeight,
      h1: document.querySelector('h1')?.innerText.replace(/\\s+/g,' ').trim().slice(0, 60) || '',
      secCount: all('section').length,
      cardCount: all('.card').length,
      roleCount: all('.role').length,
      dlCardCount: all('.dl-card').length,
      figureCount: all('figure').length,
      imgTotal: imgs.length,
      imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')).slice(0, 5),
      imgLoaded: imgs.filter(i => i.naturalWidth > 0).length,
      featureH: h(q('#features')),
      ttsH: h(q('#tts')),
      licenseH: h(q('#license')),
      downloadH: h(q('#download')),
      projectH: h(q('#project')),
      navLinks: all('.nav-links a').length,
      setupHref: all('a.btn').find(a => /获取安装包/.test(a.innerText))?.getAttribute('href') || '',
      portableHref: all('a.btn').find(a => /获取便携版/.test(a.innerText))?.getAttribute('href') || '',
      hashCopyReady: !!q('.hash') && (q('.hash').style.cursor === 'pointer'),
      stickyNav: getComputedStyle(q('.nav')).position,
      heroImgOk: (q('.hero-shot img')||{}).naturalWidth > 0,
      invisible: all('.card, .role, .dl-card, figure')
        .filter(el => parseFloat(getComputedStyle(el).opacity) < 0.9)
        .map(el => el.className || el.tagName).slice(0, 6)
    }
  })()`)

  console.log('\n页面状态: h1="' + report.h1 + '"');
  console.log('  区块=' + report.secCount + ' 卡片=' + report.cardCount + ' 角色=' + report.roleCount +
    ' 下载卡=' + report.dlCardCount + ' 图=' + report.imgLoaded + '/' + report.imgTotal);
  console.log('  安装包链接=' + report.setupHref);
  console.log('  便携版链接=' + report.portableHref);
  console.log('');

  check('页面标题正确', /守岸人陪伴终端/.test(report.title))
  check('首屏标题渲染', report.h1.length > 4, report.h1)
  check('页面有实际高度（非空白）', report.bodyH > 3000, 'bodyH=' + report.bodyH)
  check('八大区块渲染', report.secCount >= 6, 'section=' + report.secCount)
  check('功能/项目卡片渲染（≥9）', report.cardCount >= 9, 'card=' + report.cardCount)
  check('四个角色渲染', report.roleCount === 4, 'role=' + report.roleCount)
  check('下载卡片渲染', report.dlCardCount >= 2, 'dl=' + report.dlCardCount)
  check('截图占位渲染', report.figureCount >= 6, 'figure=' + report.figureCount)
  check('图片无加载失败', report.imgBroken.length === 0, 'broken=' + JSON.stringify(report.imgBroken))
  check('首屏大图加载成功', report.heroImgOk === true)
  check('软件介绍区块有高度', report.featureH > 400, 'h=' + report.featureH)
  check('下载区块有高度', report.downloadH > 400, 'h=' + report.downloadH)
  check('TTS 区块有高度', report.ttsH > 400, 'h=' + report.ttsH)
  check('项目区块有高度', report.projectH > 300, 'h=' + report.projectH)
  check('版权区块有高度', report.licenseH > 300, 'h=' + report.licenseH)
  check('顶部导航吸顶', report.stickyNav === 'sticky', report.stickyNav)
  check('导航链接渲染', report.navLinks >= 6, 'links=' + report.navLinks)
  check('哈希可复制（已绑定）', report.hashCopyReady === true)
  check('安装包按钮已被 JS 升级为真实链接', /downloads\/.*setup\.exe$/.test(decodeURIComponent(report.setupHref)), report.setupHref)
  check('便携版按钮已被 JS 升级为真实链接', /downloads\/.*portable\.exe$/.test(decodeURIComponent(report.portableHref)), report.portableHref)
  check('无内容被入场动画卡成不可见', report.invisible.length === 0, 'opacity<0.9: ' + JSON.stringify(report.invisible))
  check('无 JS 运行时异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  console.log('\n' + pass + '/' + (pass + fail) + ' 项通过')

  ws.close()
  await sleep(300)
  killAll()
  try { fs.rmSync(mainJs, { force: true }) } catch { /* ignore */ }
  server.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('验证异常:', e)
  server.close()
  killAll()
  process.exit(1)
})
