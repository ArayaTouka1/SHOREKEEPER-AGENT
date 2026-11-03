const { _electron: electron, expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')

async function main() {
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(root, '.verification', 'optimization-ui-'))
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: temp }
  delete env.ELECTRON_RUN_AS_NODE
  const requests = []
  const closed = new Set()
  let finishStreaming
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'guide-model' }] })); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const text = body.messages.at(-1)?.content || ''
    requests.push(text)
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      if (text === '流式显示') {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '渐进文字' } }] }) + '\n\n')
        finishStreaming = () => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: ' 完成' } }] }) + '\n\ndata: [DONE]\n\n')
        return
      }
      if (text === '旧请求' || text === '挂断请求') {
        res.on('close', () => closed.add(text))
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '尚未完成' } }] }) + '\n\n')
      } else {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '新的回复' } }] }) + '\n\n')
        res.end('data: [DONE]\n\n')
      }
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '测试成功' } }] }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let app
  let count = 0
  const check = async (name, fn) => { await fn(); count++; console.log('PASS ' + name) }
  try {
    app = await electron.launch({ args: ['--no-sandbox', '--in-process-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', path.join(__dirname, 'workspace-test-host.cjs')], cwd: root, env, timeout: 45000 })
    const page = await app.firstWindow()
    const mainWindow = await app.browserWindow(page)
    await mainWindow.evaluate(window => window.webContents.setBackgroundThrottling(false))
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForFunction(() => !!window.aimis)
    await page.evaluate(async () => {
      const current = (await window.aimis.settings.get()).data
      await window.aimis.settings.save({ general: { ...current.general, skipSplash: true, minimizeToTray: false }, voice: { ...current.voice, ttsEnabled: false } })
    })
    await page.reload()
    await page.waitForSelector('.main-area:visible')
    await page.keyboard.press('Control+6')
    await page.locator('[data-section="model"]').click()
    const guide = page.getByTestId('model-connection-guide')
    await check('connection guide discovers, tests and activates a local model', async () => {
      await guide.getByRole('button', { name: '开始配置', exact: true }).click()
      await guide.getByRole('button', { name: '本地模型', exact: true }).click()
      await guide.getByPlaceholder('http://127.0.0.1:11434/v1').fill(`http://127.0.0.1:${server.address().port}/v1`)
      await guide.getByRole('button', { name: '获取模型列表', exact: true }).click()
      await expect(guide.getByPlaceholder('与服务端显示的模型名称一致')).toHaveValue('guide-model')
      await expect(guide.getByRole('button', { name: '保存并使用', exact: true })).toBeDisabled()
      await guide.getByRole('button', { name: '3. 测试回复', exact: true }).click()
      await expect(guide.getByRole('button', { name: '保存并使用', exact: true })).toBeEnabled()
      await guide.getByRole('button', { name: '保存并使用', exact: true }).click()
      await expect(guide.getByRole('status')).toHaveText('已连接并切换到此模型，现在可以开始对话')
      const active = (await page.evaluate(() => window.aimis.model.state())).data.activeId
      const models = (await page.evaluate(() => window.aimis.model.list())).data
      assert.equal(models.find(model => model.id === active).model, 'guide-model')
      assert.equal(models.find(model => model.id === active).available, true)
    })
    await check('editing an already tested connection requires another test', async () => {
      await guide.getByRole('button', { name: '3. 测试回复', exact: true }).click()
      await expect(guide.getByRole('button', { name: '保存并使用', exact: true })).toBeEnabled()
      await guide.getByPlaceholder('与服务端显示的模型名称一致').fill('changed-model')
      await expect(guide.getByRole('button', { name: '保存并使用', exact: true })).toBeDisabled()
    })
    await check('text replies appear progressively while tools remain enabled', async () => {
      await page.keyboard.press('Control+2')
      const input = page.getByPlaceholder(/继续和/)
      await page.evaluate(() => { window.__streamEvents = []; window.aimis.chat.onStream(chunk => window.__streamEvents.push(chunk)) })
      await input.fill('流式显示')
      const send = page.getByRole('button', { name: /发送/, exact: false }).filter({ hasText: '发送' })
      await expect(send).toBeEnabled()
      await send.click()
      await expect.poll(() => typeof finishStreaming).toBe('function')
      await page.waitForFunction(() => window.__streamEvents.some(chunk => chunk.type === 'delta'))
      await expect(page.getByText('渐进文字', { exact: true })).toBeVisible()
      finishStreaming()
      await expect(page.getByText('渐进文字 完成', { exact: true })).toBeVisible()
    })
    await page.keyboard.press('Control+6')
    await page.locator('[data-section="voiceCall"]').click()
    await check('audio device test records synthetic input without accessing a real microphone', async () => {
      await page.getByRole('button', { name: '麦克风试录 3 秒', exact: true }).click()
      await expect(page.getByRole('button', { name: '回放试录', exact: true })).toBeEnabled({ timeout: 15000 })
      await expect(page.getByRole('button', { name: '扬声器试听', exact: true })).toBeVisible()
    })
    const windowPromise = app.waitForEvent('window')
    await page.evaluate(() => window.aimis.call.open(undefined, 'voice'))
    const call = await windowPromise
    call.on('pageerror', error => errors.push(error.message))
    await call.waitForSelector('.live-call-window.is-voice')
    await call.waitForFunction(async () => {
      const result = await window.aimis.call.begin()
      if (result.ok) { window.__testCallId = result.data.conversationId; return true }
      return false
    })
    await call.evaluate(() => { window.__testChunks = []; window.aimis.chat.onStream(chunk => window.__testChunks.push(chunk)) })
    await check('voice-only call creates no model canvas and reuses its conversation', async () => {
      assert.equal(await call.locator('canvas').count(), 0)
      const ids = await call.evaluate(async () => [(await window.aimis.call.begin()).data.conversationId, (await window.aimis.call.begin()).data.conversationId])
      assert.equal(ids[0], ids[1])
    })
    await check('a replacement call request aborts the old stream without a stale reply', async () => {
      await call.evaluate(() => window.aimis.call.send({ conversationId: window.__testCallId, text: '旧请求' }))
      await expect.poll(() => requests.includes('旧请求')).toBe(true)
      await call.evaluate(() => window.aimis.call.send({ conversationId: window.__testCallId, text: '新请求' }))
      await call.waitForFunction(() => window.__testChunks.some(chunk => chunk.type === 'done' && chunk.text === '新的回复'))
      await expect.poll(() => closed.has('旧请求')).toBe(true)
      assert.deepEqual(await call.evaluate(() => window.__testChunks.filter(chunk => chunk.type === 'done').map(chunk => chunk.text)), ['新的回复'])
    })
    await check('hanging up cancels an in-flight model request', async () => {
      await call.evaluate(() => window.aimis.call.send({ conversationId: window.__testCallId, text: '挂断请求' }))
      await expect.poll(() => requests.includes('挂断请求')).toBe(true)
      await call.evaluate(() => window.aimis.call.close())
      await expect.poll(() => closed.has('挂断请求')).toBe(true)
    })
    assert.deepEqual(errors, [])
    console.log(`Completed ${count} Electron UI checks with isolated profile: ${temp}`)
  } finally {
    if (app) await app.close().catch(() => undefined)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
