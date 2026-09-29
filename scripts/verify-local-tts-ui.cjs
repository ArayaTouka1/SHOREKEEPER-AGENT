/**
 *
 *
 */
const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

;(async () => {
  const root = path.resolve(__dirname, '..')
  const profile = fs.mkdtempSync(path.join(root, '.verification/tts-ui-'))
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'workspace-test-host.cjs')],
    cwd: root,
    env
  })

  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.aimis)

    await page.waitForSelector('.splash', { timeout: 15000 })
    await page.locator('.splash').click({ position: { x: 40, y: 100 } })
    await page.waitForSelector('.splash', { state: 'detached', timeout: 8000 })

    await page.keyboard.press('Control+6')
    await page.waitForTimeout(800)
    await page.locator('[data-label="语音"], .set-item:has-text("语音")').first().click()
    await page.waitForTimeout(1000)

    const localCard = page.locator('.pick-card').filter({ hasText: '本地合成' })
    if (await localCard.count()) {
      await localCard.first().click()
      await page.waitForTimeout(1200)
    }

    let pass = 0, fail = 0
    const check = (n, c, e) => { if (c) { pass++; console.log('  OK   ' + n) } else { fail++; console.log('  FAIL ' + n + (e ? '  -> ' + e : '')) } }

    const panelText = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="qwen-one-click"]')?.closest('div,section') || document.body
      return {
        body: document.body.innerText,
        hostText: host ? host.innerText : ''
      }
    })

    const options = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'))
      for (const s of selects) {
        const labels = Array.from(s.options).map((o) => o.textContent || '')
        if (labels.some((l) => /Qwen3/.test(l))) return labels
      }
      return []
    })

    check('引擎下拉含 Qwen3-TTS 选项', options.some((o) => /Qwen3/.test(o)), JSON.stringify(options))
    check('引擎下拉含「自定义」选项', options.some((o) => o.trim() === '自定义'), JSON.stringify(options))
    check('引擎下拉不含「其他 TTS」', !options.some((o) => /其他 TTS/.test(o)), JSON.stringify(options))

    check('界面未出现具名模型 GPT-SoVITS', !/GPT-SoVITS/i.test(panelText.body))
    check('界面未出现具名模型 CosyVoice', !/CosyVoice/i.test(panelText.body))

    const deploy = await page.evaluate(() => ({
      hasPanel: !!document.querySelector('[data-testid="qwen-one-click"]'),
      hasBtn: !!document.querySelector('[data-testid="qwen-deploy"]'),
      hasVoices: !!document.querySelector('[data-testid="deploy-voices"]'),
      hasService: !!document.querySelector('[data-testid="deploy-service"]'),
      voicesText: document.querySelector('[data-testid="deploy-voices"]')?.textContent || ''
    }))
    check('一键部署面板已渲染', deploy.hasPanel === true)
    check('一键部署按钮存在', deploy.hasBtn === true)
    check('参考音色状态显示（应为 x/4）', /\/\s*4/.test(deploy.voicesText), deploy.voicesText)
    check('语音服务状态已渲染', deploy.hasService === true)

    const svc = await page.evaluate(() => ({
      state: !!document.querySelector('[data-testid="tts-service-state"]'),
      autostart: !!document.querySelector('[data-testid="tts-service-autostart"]'),
      start: !!document.querySelector('[data-testid="tts-service-start"]'),
      stop: !!document.querySelector('[data-testid="tts-service-stop"]'),
      stopDisabled: document.querySelector('[data-testid="tts-service-stop"]')?.disabled
    }))
    check('服务状态徽标渲染', svc.state === true)
    check('自动启动开关渲染', svc.autostart === true)
    check('启动服务按钮渲染', svc.start === true)
    check('停止服务按钮渲染', svc.stop === true)
    check('未由本应用拉起时「停止」不可点（防误杀外部服务）', svc.stopDisabled === true, 'disabled=' + svc.stopDisabled)

    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'))
      for (const s of selects) {
        const opt = Array.from(s.options).find((o) => (o.textContent || '').trim() === '自定义')
        if (opt) {
          s.value = opt.value
          s.dispatchEvent(new Event('change', { bubbles: true }))
          break
        }
      }
    })
    await page.waitForTimeout(1200)

    const customUI = await page.evaluate(() => {
      const text = document.body.innerText
      return {
        hasRefAudio: /参考音频/.test(text),
        hasRefText: /参考文本/.test(text),
        hasPick: Array.from(document.querySelectorAll('button')).some((b) => /选择/.test(b.textContent || ''))
      }
    })
    check('自定义模式有「参考音频」入口', customUI.hasRefAudio === true)
    check('自定义模式有「参考文本」输入', customUI.hasRefText === true)

    console.log('\n' + pass + '/' + (pass + fail) + ' 项通过')
    process.exitCode = fail === 0 ? 0 : 1
  } finally {
    await app.close()
  }
})().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e)
  process.exitCode = 1
})
