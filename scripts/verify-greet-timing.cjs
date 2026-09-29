/**
 *
 *
 *
 */
const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

;(async () => {
  const root = path.resolve(__dirname, '..')
  const profile = fs.mkdtempSync(path.join(root, '.verification/greet-'))
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const native = process.argv.includes('--native')

  const app = await electron.launch(
    native
      ? { executablePath: path.join(root, 'release/win-unpacked/守岸人陪伴终端.exe'), args: ['--no-sandbox', '--in-process-gpu', `--user-data-dir=${profile}`], cwd: root, env }
      : { args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'workspace-test-host.cjs')], cwd: root, env }
  )

  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.aimis)

    const stub = `(() => {
      window.__voicePlays = window.__voicePlays || []
      const isVoice = (el) => {
        const tag = (el.tagName || '').toLowerCase()
        const src = String(el.src || el.currentSrc || '')
        if (tag === 'video') return false
        if (/\\.(mp4|webm|mov|mkv|m4v)(\\?|$)/i.test(src)) return false
        if (tag === 'audio') return true
        return /(\\.mp3|\\.wav|\\.ogg|\\.m4a)(\\?|$)/i.test(src)
      }
      const orig = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        try { if (isVoice(this)) window.__voicePlays.push({ src: String(this.src || '').slice(0, 120) }) } catch (e) {}
        return orig.apply(this, arguments)
      }
    })()`
    await page.addInitScript(stub)
    await page.evaluate(stub)

    await page.waitForSelector('.splash', { timeout: 15000 })
    await page.locator('.splash').click({ position: { x: 40, y: 100 } })
    await page.waitForSelector('.splash', { state: 'detached', timeout: 8000 })

    await page.waitForTimeout(2500)
    const visibleCrumb = `(() => {
      const els = Array.from(document.querySelectorAll('.page-crumb'))
      const vis = els.find(el => el.offsetParent !== null && el.getBoundingClientRect().height > 0)
      return vis ? vis.textContent : ''
    })()`
    const homeRoute = await page.evaluate(visibleCrumb)
    assert(homeRoute.includes('首页'), '启动后应停在首页，实际：' + JSON.stringify(homeRoute))

    const playsAtHome = await page.evaluate(() => {
      return (window.__voicePlays || []).map((p) => p.src)
    })
    if (playsAtHome.length) console.log('  首页期间实际播放:', JSON.stringify(playsAtHome))
    assert.equal(playsAtHome.length, 0, '启动停留在首页时不应播放任何语音，实际播放 ' + playsAtHome.length + ' 次')
    console.log('PASS 启动停留在首页：0 次语音播放')

    const msgsAtHome = await page.evaluate(async () => {
      const conv = await window.aimis.conversation.list()
      const first = Array.isArray(conv.data) ? conv.data[0] : null
      if (!first) return { total: 0, proactive: 0 }
      const r = await window.aimis.message.list(first.id)
      const list = Array.isArray(r.data) ? r.data : []
      return { total: list.length, proactive: list.filter((m) => m.proactive).length }
    })
    assert.equal(msgsAtHome.proactive, 0, '启动时不该产生主动问候消息，实际 ' + msgsAtHome.proactive + ' 条')
    console.log('PASS 启动停留在首页：0 条主动问候消息')

    await page.keyboard.press('Control+2')
    await page.waitForTimeout(2500)

    const crumb = await page.evaluate(visibleCrumb)
    assert(crumb.includes('对话'), '应已进入对话页，实际：' + JSON.stringify(crumb))

    const greetProbe = await page.evaluate(async () => {
      const rel = await window.aimis.relationship.get()
      return { ok: rel.ok, stage: rel.data && rel.data.stage, greeting: rel.data && rel.data.greeting }
    })
    console.log('  关系快照:', JSON.stringify(greetProbe))

    const afterEnter = await page.evaluate(async () => {
      window.__voicePlays = window.__voicePlays || []
      const conv = await window.aimis.conversation.list()
      const first = Array.isArray(conv.data) ? conv.data[0] : null
      let proactive = 0
      if (first) {
        const r = await window.aimis.message.list(first.id)
        const list = Array.isArray(r.data) ? r.data : []
        proactive = list.filter((m) => m.proactive).length
      }
      return {
        voicePlays: (window.__voicePlays || []).length,
        proactive
      }
    })
    assert.equal(afterEnter.proactive, 1, '进入对话页应有 1 条主动问候，实际 ' + afterEnter.proactive)
    assert.equal(afterEnter.voicePlays, 1, '进入对话页应播放 1 次问候语音，实际 ' + afterEnter.voicePlays)
    console.log('PASS 进入对话页：1 条主动问候 + 1 次语音播放')

    await page.keyboard.press('Control+1')
    await page.waitForTimeout(1200)
    await page.keyboard.press('Control+2')
    await page.waitForTimeout(2000)

    const afterReturn = await page.evaluate(async () => {
      const conv = await window.aimis.conversation.list()
      const first = Array.isArray(conv.data) ? conv.data[0] : null
      let proactive = 0
      if (first) {
        const r = await window.aimis.message.list(first.id)
        const list = Array.isArray(r.data) ? r.data : []
        proactive = list.filter((m) => m.proactive).length
      }
      return {
        voicePlays: (window.__voicePlays || []).length,
        proactive
      }
    })
    assert.equal(afterReturn.proactive, 1, '切回对话页不该重复问候，实际 ' + afterReturn.proactive + ' 条')
    assert.equal(afterReturn.voicePlays, 1, '切回对话页不该重复播放语音，实际 ' + afterReturn.voicePlays + ' 次')
    console.log('PASS 切走再切回：不重复问候、不重复播放')

    console.log('\n全部通过')
  } finally {
    await app.close()
  }
})().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e)
  process.exitCode = 1
})
