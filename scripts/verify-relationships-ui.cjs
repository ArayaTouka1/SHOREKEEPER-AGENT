const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const profile = fs.mkdtempSync(path.join(root, '.verification', 'relationships-ui-'))
  fs.mkdirSync(path.join(profile, 'data'))
  const record = score => ({ score, lastInteractionAt: 0, lastAwardAt: 0, day: '', earnedToday: 0, recent: [], events: [], openingSlot: '' })
  fs.writeFileSync(path.join(profile, 'data/relationships.json'), JSON.stringify({ char_shorekeeper: record(65), char_chloe: record(45) }))
  const requests = []
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const c of req) data += c
    requests.push(JSON.parse(data))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '我在，先说说你今天想做的事。' } }] }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE
  let app
  let checks = 0
  const test = async (name, work) => { await work(); checks++; console.log('PASS ' + name) }
  try {
    app = await electron.launch({ args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'workspace-test-host.cjs')], cwd: root, env, timeout: 45000 })
    const page = await app.firstWindow()
    page.on('pageerror', e => console.error('RENDERER', e.message))
    page.on('dialog', d => d.accept())
    await page.waitForFunction(() => !!window.aimis)
    await page.evaluate(async endpoint => {
      const settings = (await window.aimis.settings.get()).data
      await window.aimis.settings.save({ general: { ...settings.general, skipSplash: true }, voice: { ...settings.voice, ttsEnabled: false } })
      const model = await window.aimis.model.add({ name: 'Persona verification', kind: 'api', baseUrl: endpoint, model: 'persona-test', apiKey: 'local-test-key' })
      await window.aimis.model.setActive(model.data.model.id)
    }, 'http://127.0.0.1:' + server.address().port + '/v1')
    await page.reload()
    await page.waitForFunction(() => !!document.querySelector('.main-area'))
    await page.keyboard.press('Control+6')
    await test('settings show profile and affection, with no prompt editor or reveal button', async () => {
      await expect(page.getByTestId('character-profile')).toContainText('黑海岸的守护者')
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('亲密')
      await expect(page.getByTestId('persona-editor')).toHaveCount(0)
      await expect(page.getByTestId('persona-reveal')).toHaveCount(0)
      await expect(page.getByText('System Prompt 正文', { exact: true })).toHaveCount(0)
    })
    await test('switching character restores its own profile and relationship', async () => {
      await page.locator('[data-char-id="char_chloe"]').click()
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('信任')
      await expect(page.getByTestId('character-profile')).toContainText('学生会长')
      await page.locator('[data-char-id="char_aemeath"]').click()
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('陌生')
      await expect(page.getByTestId('character-profile')).toContainText('星炬学院')
      await page.locator('[data-char-id="char_shorekeeper"]').click()
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('亲密')
    })
    const screenshot = async name => {
      await page.waitForTimeout(1200)
      const bw = await app.browserWindow(page)
      const data = await bw.evaluate(async w => (await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
      fs.writeFileSync(path.join(profile, name), Buffer.from(data, 'base64'))
    }
    await page.getByTestId('character-profile').scrollIntoViewIfNeeded()
    await screenshot('settings-affinity.png')
    await test('the actual model request includes character source and current tier', async () => {
      await page.keyboard.press('Control+2')
      await expect(page.getByTestId('affinity-badge')).toHaveText('亲密')
      await page.locator('textarea').fill('你好，今天想和你讨论一个新的计划。')
      await page.getByTestId('chat-send').click()
      await expect.poll(() => requests.length, { timeout: 20000 }).toBe(1)
      const prompt = requests[0].messages[0].content
      assert.match(prompt, /当前关系阶段：亲密/)
      assert.match(prompt, /黑海岸/)
      assert.match(prompt, /本机当地时间/)
      assert.ok(!prompt.includes('## 陌生｜'))
      await expect(page.getByText('我在，先说说你今天想做的事。', { exact: true })).toBeVisible()
    })
    await test('reset affects one character and the next model request', async () => {
      await page.keyboard.press('Control+6')
      await page.getByRole('button', { name: '重置当前角色好感', exact: true }).click()
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('陌生')
      assert.equal((await page.evaluate(() => window.aimis.relationship.get('char_chloe'))).data.stage, '信任')
      await page.keyboard.press('Control+2')
      await page.locator('textarea').fill('我们继续刚才的话题吧。')
      await page.getByTestId('chat-send').click()
      await expect.poll(() => requests.length, { timeout: 20000 }).toBe(2)
      assert.match(requests[1].messages[0].content, /当前关系阶段：陌生/)
    })
    await test('relationship survives renderer reload and compact layout', async () => {
      await page.reload()
      await page.waitForFunction(() => !!document.querySelector('.main-area'))
      await page.keyboard.press('Control+6')
      await page.setViewportSize({ width: 900, height: 760 })
      await expect(page.getByTestId('affinity-panel').locator('strong')).toHaveText('陌生')
      const panel = page.getByTestId('affinity-panel')
      await panel.scrollIntoViewIfNeeded()
      assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
      await screenshot('settings-affinity-compact.png')
    })
    console.log(checks + ' GUI checks passed. Screenshots: ' + profile)
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
    await new Promise(done => server.close(done))
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
