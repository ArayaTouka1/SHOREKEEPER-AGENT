const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')

async function main() {
  const root = path.resolve(__dirname, '..')
  const profile = fs.mkdtempSync(path.join(root, '.verification/chat-flow-'))
  const workspace = path.join(profile, 'workspace')
  fs.mkdirSync(workspace)
  fs.writeFileSync(path.join(workspace, 'read-me.txt'), 'VERIFIED_FILE_CONTENT_728')
  let requests = 0
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body)
    requests++
    let message
    if (input.messages.some(m => m.content?.includes?.('测试语音'))) message = { content: '语音开始以后，这段文字才会显示。' }
    else if (input.messages.some(m => m.role === 'tool')) {
      assert.ok(input.messages.some(m => m.role === 'tool' && m.content.includes('VERIFIED_FILE_CONTENT_728')))
      message = { content: '文件读取完成：VERIFIED_FILE_CONTENT_728。' }
    } else if (input.messages.some(m => m.role === 'assistant' && m.content === '让我先看看这个文件。')) message = { content: null, tool_calls: [{ id: 'read_1', type: 'function', function: { name: 'fs_read', arguments: JSON.stringify({ path: path.join(workspace, 'read-me.txt') }) } }] }
    else message = { content: '让我先看看这个文件。' }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message } }] }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const env = { ...process.env, WORKSPACE_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await electron.launch({ args: ['--no-sandbox', '--in-process-gpu', path.join(__dirname, 'workspace-test-host.cjs')], cwd: root, env, timeout: 45000 })
    const page = await app.firstWindow()
    const screenshot = async name => {
      await page.waitForTimeout(1000)
      const window = await app.browserWindow(page)
      await window.evaluate(w => w.showInactive())
      await page.waitForTimeout(800)
      const data = await window.evaluate(async w => (await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
      fs.writeFileSync(path.join(profile, name), Buffer.from(data, 'base64'))
      await window.evaluate(w => w.hide())
    }
    await page.waitForFunction(() => !!window.aimis)
    await page.evaluate(async ({ workspace, url }) => {
      const s = (await window.aimis.settings.get()).data
      await window.aimis.settings.save({ general: { ...s.general, skipSplash: true }, voice: { ...s.voice, ttsEnabled: false }, agent: { ...s.agent, workspace } })
      const m = await window.aimis.model.add({ name: 'Flow test', kind: 'api', baseUrl: url, model: 'test', apiKey: 'mock' })
      await window.aimis.model.setActive(m.data.model.id)
    }, { workspace, url: 'http://127.0.0.1:' + server.address().port + '/v1' })
    await page.reload()
    await page.waitForFunction(() => !!document.querySelector('.main-area'))
    await page.keyboard.press('Control+2')
    await expect(page.getByTestId('permission-badge')).toHaveAttribute('data-tier', 'view')
    await expect.poll(async () => page.evaluate(async () => {
      const cs = (await window.aimis.conversation.list()).data
      if (!cs.length) return false
      const ms = (await window.aimis.message.list(cs[0].id)).data
      return ms.some(m => m.proactive && m.role === 'character') && !ms.some(m => m.role === 'user')
    })).toBe(true)
    console.log('PASS fresh read-only UI and proactive greeting before any user message')

    await page.getByTestId('permission-badge').click()
    await page.getByRole('checkbox', { name: '信任此工作区' }).check()
    await expect(page.getByTestId('permission-badge')).toHaveAttribute('data-tier', 'workspace')
    await page.keyboard.press('Escape')
    await page.evaluate(path => { window.pendingWrite = window.aimis.agent.run({ name: 'fs_write', params: { path, content: '', createOnly: true } }) }, path.join(workspace, 'empty.txt'))
    await expect(page.getByTestId('operation-approval')).toBeVisible()
    await screenshot('inline-approval.png')
    await page.getByTestId('operation-approval').getByRole('button', { name: '允许一次' }).click()
    assert.equal((await page.evaluate(() => window.pendingWrite)).ok, true)
    assert.equal(fs.readFileSync(path.join(workspace, 'empty.txt'), 'utf8'), '')
    console.log('PASS workspace trust is functional; inline approval creates an empty file')

    await page.evaluate(() => window.aimis.agent.setMachinePermission('full'))
    await expect(page.getByTestId('permission-badge')).toHaveAttribute('data-tier', 'full')
    await page.evaluate(() => window.aimis.agent.trust(false))
    const result = await page.evaluate(path => window.aimis.agent.run({ name: 'fs_write', params: { path, content: 'direct' } }), path.join(profile, 'outside.txt'))
    assert.equal(result.ok, true)
    assert.equal(fs.readFileSync(path.join(profile, 'outside.txt'), 'utf8'), 'direct')
    await expect(page.getByTestId('operation-approval')).toHaveCount(0)
    console.log('PASS changed permissions synchronize without reload; full access writes outside workspace without approval')

    await page.locator('textarea').fill('请查看 read-me.txt 并告诉我内容')
    await page.getByTestId('chat-send').click()
    await expect(page.getByText('文件读取完成：VERIFIED_FILE_CONTENT_728。', { exact: true })).toBeVisible({ timeout: 30000 })
    assert.equal(requests, 3)
    await expect(page.getByText('读取文件', { exact: true })).toHaveCount(0)
    console.log('PASS promise-only reply continues automatically to actual file evidence; read cards stay hidden')

    await page.evaluate(async () => {
      const s = (await window.aimis.settings.get()).data
      const cs = (await window.aimis.character.list()).data
      await window.aimis.character.save({ id: 'char_shorekeeper', voice: { ...cs.find(c => c.id === 'char_shorekeeper').voice, engine: 'system', autoSpeak: true } })
      await window.aimis.settings.save({ voice: { ...s.voice, ttsEnabled: true } })
      window.speechSynthesis.speak = utterance => { window.testUtterance = utterance }
    })
    await expect(page.locator('[data-speech-mode]')).toHaveAttribute('data-speech-mode', 'synth', { timeout: 20000 })
    await page.locator('textarea').fill('测试语音')
    await page.getByTestId('chat-send').click()
    try { await expect.poll(() => page.evaluate(() => !!window.testUtterance)).toBe(true) } catch (error) { console.log(await page.evaluate(() => ({ speech: typeof window.speechSynthesis, text: document.body.innerText.slice(-1600) }))); throw error }
    await expect(page.getByTestId('sync-bubble')).toHaveCount(0)
    await expect(page.getByText('语音开始以后，这段文字才会显示。', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('tethys-review')).toBeVisible()
    await page.evaluate(() => window.testUtterance.onstart())
    await expect(page.getByTestId('sync-bubble')).toBeVisible()
    await page.evaluate(() => window.testUtterance.onend())
    await expect(page.getByText('语音开始以后，这段文字才会显示。', { exact: true })).toBeVisible()
    await screenshot('chat-result.png')
    console.log('PASS reply bubble waits for playback start and settles after playback end. Screenshots: ' + profile)
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
    await new Promise(done => server.close(done))
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
