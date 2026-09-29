/**
 */
const { spawn, execSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const WEB = path.resolve(ROOT, '..', 'web')
const OUT = path.join(WEB, 'assets', 'site-preview')
const PORT = 9365
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' }
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0])
  if (u === '/') u = '/index.html'
  const full = path.join(WEB, u.replace(/^\/+/, ''))
  if (!full.startsWith(WEB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' })
  fs.createReadStream(full).pipe(res)
})
const killAll = () => { try { execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' }) } catch { /* ignore */ } }

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  killAll(); await sleep(700)

  const userData = path.join(process.env.TEMP || '/tmp', 'sk-full-' + Date.now())
  const mainJs = path.join(process.env.TEMP || '/tmp', 'sk-full-main-' + Date.now() + '.cjs')
  ok: fs.writeFileSync(mainJs, `const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { offscreen: false } })
  w.loadURL('http://127.0.0.1:${PORT}/index.html')
  setTimeout(() => app.quit(), 90000)
})
app.on('window-all-closed', () => app.quit())
`, 'utf8')

  const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    [mainJs, '--no-sandbox', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT + 1}`],
    { cwd: ROOT, detached: true, stdio: 'ignore' })
  child.unref()

  const BASE = `http://127.0.0.1:${PORT + 1}`
  let page = null
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(BASE + '/json/list')).json(); page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) break } catch { /* wait */ }
    await sleep(500)
  }
  if (!page) { console.error('FAIL: 未启动'); server.close(); killAll(); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const send = (m, p = {}) => new Promise((res) => {
    const mid = ++id
    const on = (e) => { const x = JSON.parse(e.data); if (x.id === mid) { ws.removeEventListener('message', on); res(x.result) } }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method: m, params: p }))
  })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  await sleep(6000)
  await ev('window.scrollTo(0, document.body.scrollHeight)')
  await sleep(3000)
  await ev('window.scrollTo(0, 0)')
  await sleep(1200)

  const h = await ev('document.body.scrollHeight')
  const w = 1440
  console.log('页面尺寸: ' + w + ' x ' + h)

  const seg = Math.ceil(h / 4)
  const shots = [
    ['01-top', 0, seg],
    ['02-mid', seg, seg * 2],
    ['03-lower', seg * 2, seg * 3],
    ['04-bottom', seg * 3, h]
  ]
  for (const [name, y, y2] of shots) {
    const r = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: y, width: w, height: Math.max(200, y2 - y), scale: 1 }
    })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
    console.log('  已截图 ' + name + '.png  (y=' + y + ' h=' + Math.max(200, y2 - y) + ')')
  }

  console.log('\n截图目录: ' + OUT)
  ws.close(); await sleep(300); killAll()
  try { fs.rmSync(mainJs, { force: true }) } catch { /* ignore */ }
  server.close()
  process.exit(0)
})().catch((e) => { console.error('异常:', e); server.close(); killAll(); process.exit(1) })
