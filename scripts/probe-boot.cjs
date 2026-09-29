/**
 */
const PORT = process.argv[2] || 9223
const BASE = `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function list() {
  const res = await fetch(BASE + '/json/list')
  return res.json()
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let id = 0
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        p(m)
      }
    })
    ws.addEventListener('open', () =>
      resolve({
        eval: (expression) =>
          new Promise((res2) => {
            const myId = ++id
            pending.set(myId, (m) => res2(m.result?.result?.value ?? m.result?.exceptionDetails ?? null))
            ws.send(
              JSON.stringify({
                id: myId,
                method: 'Runtime.evaluate',
                params: { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true }
              })
            )
          }),
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', reject)
  })
}

;(async () => {
  let page = null
  for (let i = 0; i < 40; i++) {
    try {
      const t = await list()
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
      if (page) break
    } catch {
    }
    await sleep(500)
  }
  if (!page) {
    console.log('没有找到页面 target')
    process.exit(1)
  }

  console.log('已连接: ' + page.url)
  const cdp = await connect(page.webSocketDebuggerUrl)

  for (let i = 0; i < 24; i++) {
    const s = await cdp.eval(`
      return {
        readyState: document.readyState,
        hasShell: !!document.querySelector('.app-shell'),
        hasSplash: !!document.querySelector('.splash'),
        splashTitle: document.querySelector('.splash-title')?.textContent ?? null,
        hasRail: document.querySelectorAll('.rail-item').length,
        hasSplashBtn: !!document.querySelector('.splash-btn'),
        bodyText: document.body.innerText.replace(/\\n/g, ' | ').slice(0, 60)
      }
    `)
    console.log(
      `t=${String(i * 500).padStart(5)}ms  shell=${s.hasShell ? 1 : 0} splash=${s.hasSplash ? 1 : 0}` +
        ` btn=${s.hasSplashBtn ? 1 : 0} rail=${s.hasRail} title=${JSON.stringify(s.splashTitle)}  | ${s.bodyText}`
    )
    await sleep(500)
  }

  const after = await cdp.eval(`
    const btn = document.querySelector('.splash-btn')
    if (!btn) return { clicked: false, reason: '没有启动页按钮' }
    btn.click()
    await new Promise(r => setTimeout(r, 900))
    return {
      clicked: true,
      splashGone: !document.querySelector('.splash'),
      rail: document.querySelectorAll('.rail-item').length,
      title: document.querySelector('.page-title')?.textContent ?? ''
    }
  `)
  console.log('点击后: ' + JSON.stringify(after))

  cdp.close()
})().catch((e) => {
  console.error('探针失败:', e.message)
  process.exit(2)
})
