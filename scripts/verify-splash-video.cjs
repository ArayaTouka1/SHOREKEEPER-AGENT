/**
 *   - readyState >= 2
 */
const { spawn, execSync } = require('node:child_process')
const { existsSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const PORT = 9291
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function killAll() {
  for (const n of ['shorekeeper-agent', 'electron']) {
    try { execSync(`taskkill /F /IM "${n}.exe" /T`, { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

const FRESH = join(process.env.TEMP || '/tmp', 'sk-splash-' + Date.now())

;(async () => {
  killAll()
  await sleep(1200)
  rmSync(FRESH, { recursive: true, force: true })
  mkdirSync(FRESH, { recursive: true })

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
    } catch { /* wait */ }
    await sleep(500)
  }
  if (!page) { console.error('FAIL: 应用未启动'); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    const onMsg = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === mid) { ws.removeEventListener('message', onMsg); res(m.result) }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed')
    return r.result.value
  }

  await sleep(4000)

  let pass = 0, fail = 0
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  OK   ' + name) }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')) }
  }

  const state = await ev(`(() => {
    const v = document.querySelector('.splash-video video, video.splash-video, .splash video, video')
    if (!v) return { found: false }
    return {
      found: true,
      src: (v.currentSrc || v.src || '').slice(0, 40),
      readyState: v.readyState,
      currentTime: v.currentTime,
      duration: v.duration,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      paused: v.paused,
      ended: v.ended,
      networkState: v.networkState,
      error: v.error ? (v.error.code + ':' + (v.error.message || '')) : null
    }
  })()`)

  console.log('video 状态:', JSON.stringify(state, null, 2))

  check('video 元素存在', state.found === true)
  if (state.found) {
    check('视频源已就绪（data URL）', String(state.src).startsWith('data:video'))
    check('readyState >= 2（有数据可播）', state.readyState >= 2, 'readyState=' + state.readyState)
    check('videoWidth > 0（解码出画面，非黑屏）', state.videoWidth > 0, 'videoWidth=' + state.videoWidth)
    check('无加载错误', !state.error, 'error=' + state.error)
    check('视频在播放中（currentTime 前进）', state.currentTime > 0 && !state.ended, 'currentTime=' + state.currentTime + ' paused=' + state.paused)
    check('duration 有效', Number.isFinite(state.duration) && state.duration > 0, 'duration=' + state.duration)
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' 项通过')
  ws.close()
  await sleep(300)
  killAll()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('验证脚本异常:', e); killAll(); process.exit(1) })
