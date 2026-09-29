/**
 */
const PORT = process.argv[2] || 9225
const BASE = 'http://127.0.0.1:' + PORT
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const list = await (await fetch(BASE + '/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) {
    console.error('没有找到页面 target')
    process.exit(1)
  }
  console.log('URL: ' + page.url)

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
  const ev = (expr) =>
    new Promise((res) => {
      const my = ++id
      pend.set(my, (m) => res(m.result?.result?.value))
      ws.send(
        JSON.stringify({
          id: my,
          method: 'Runtime.evaluate',
          params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }
        })
      )
    })

  for (let i = 0; i < 40; i++) {
    const rail = await ev(`return document.querySelectorAll('.rail-item').length`)
    if (rail === 6) break
    await sleep(400)
  }

  const r = await ev(`
    return {
      rail: document.querySelectorAll('.rail-item').length,
      splash: !!document.querySelector('.splash'),
      splashBtn: !!document.querySelector('.splash-btn'),
      pageTitle: document.querySelector('.page-title')?.textContent || '',
      hasAvatar: !!document.querySelector('.card img'),
      bodyLen: document.body.innerText.length
    }
  `)
  console.log('运行时状态: ' + JSON.stringify(r))

  await ev(`
    const btn = document.querySelector('.splash-btn')
    if (btn) { btn.click(); await new Promise(r=>setTimeout(r,900)) }
    const set = [...document.querySelectorAll('.rail-item')].find(e=>e.textContent.includes('设置'))
    if (set) set.click()
    await new Promise(r=>setTimeout(r,700))
    return true
  `)
  const s = await ev(`
    return {
      sections: [...document.querySelectorAll('.set-item')].map(e=>e.textContent.trim()),
      brand: document.body.innerText.includes('COMPANION OS')
    }
  `)
  console.log('设置分页: ' + s.sections.length + ' 个 -> ' + s.sections.join(' / '))
  console.log('COMPANION OS 品牌字: ' + s.brand)

  ws.close()
})().catch((e) => {
  console.error('检查失败: ' + e.message)
  process.exit(1)
})
